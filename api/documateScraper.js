import * as cheerio from 'cheerio';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { urls } = req.body;
    if (!urls || !Array.isArray(urls)) return res.status(400).json({ error: "No URLs provided" });

    const results = await Promise.all(urls.slice(0, 10).map(async (url) => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        const response = await fetch(url, { 
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            },
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (!response.ok) throw new Error(`Status ${response.status}`);
        
        const html = await response.text();
        const $ = cheerio.load(html);

        let author = "";
        let date = "";
        let site = "";
        let title = "";

        // --- 1. EXTRACT TITLE ---
        title = $('meta[property="og:title"]').attr('content') || 
                $('meta[name="twitter:title"]').attr('content') || 
                $('h1').first().text().trim() || 
                $('title').text().trim();

        // --- 2. JSON-LD EXTRACTION (Structured Metadata - High Confidence) ---
        $('script[type="application/ld+json"]').each((i, el) => {
            try {
                const json = JSON.parse($(el).html());
                // Normalize to array to handle @graph or single objects
                let objects = Array.isArray(json) ? json : (json['@graph'] || [json]);
                
                // Find the main Article object
                const article = objects.find(o => 
                    ['Article', 'NewsArticle', 'BlogPosting', 'Report', 'ScholarlyArticle', 'TechArticle'].includes(o['@type'])
                );

                if (article) {
                    // Date
                    if (!date && (article.datePublished || article.dateCreated)) {
                        date = article.datePublished || article.dateCreated;
                    }
                    
                    // Authors (Handle Arrays correctly!)
                    if (!author && article.author) {
                        if (Array.isArray(article.author)) {
                            // Map over array: [{name: "Victor"}, {name: "Taylor"}] -> "Victor, Taylor"
                            author = article.author
                                .map(a => (typeof a === 'string' ? a : a.name))
                                .filter(n => n && !n.includes('http')) // Filter out URLs
                                .join(', ');
                        } else if (typeof article.author === 'object' && article.author.name) {
                            author = article.author.name;
                        } else if (typeof article.author === 'string') {
                            author = article.author;
                        }
                    }
                    
                    // Site
                    if (!site && article.publisher) {
                        site = (typeof article.publisher === 'string') ? article.publisher : article.publisher.name;
                    }
                }
            } catch(e) {}
        });

        // --- 3. DOM BYLINE EXTRACTION (Controlled Scraping - Medium Confidence) ---
        // If JSON-LD failed, look for specific "byline" classes (common in news sites like ABC)
        if (!author) {
            // Selectors for byline containers
            const bylineSelectors = [
                '[data-testid="prism-byline"]', // ABC News specific
                '.byline', 
                '.author-list', 
                '.contributors',
                '[class*="byline"]',
                '[class*="author-"]'
            ];

            for (const sel of bylineSelectors) {
                const container = $(sel).first();
                if (container.length) {
                    // Strategy A: Look for links inside the byline (usually authors)
                    const links = container.find('a');
                    if (links.length > 0) {
                        const names = [];
                        links.each((i, link) => {
                            const txt = $(link).text().trim();
                            // Filter out "Twitter", "Email", etc.
                            if (txt.length > 2 && !['Follow', 'Email', 'Twitter'].includes(txt)) {
                                names.push(txt);
                            }
                        });
                        if (names.length > 0) {
                            author = names.join(', ');
                            break; 
                        }
                    }
                    
                    // Strategy B: Just get the text if no links
                    const text = container.text().replace(/By\s+/i, '').trim();
                    if (text.length > 3 && text.length < 100) {
                        author = text;
                        break;
                    }
                }
            }
        }

        // --- 4. META TAGS (Low Confidence) ---
        if (!author) {
            const authorTags = ['citation_author', 'dc.creator', 'author', 'article:author', 'parsely-author', 'sailthru.author'];
            const found = [];
            authorTags.forEach(tag => {
                $(`meta[name="${tag}"], meta[property="${tag}"]`).each((i, el) => {
                    const val = $(el).attr('content');
                    if (val && !found.includes(val)) found.push(val);
                });
            });
            if (found.length > 0) author = found.join(', ');
        }

        // --- 5. DATE & SITE FALLBACKS ---
        if (!date) {
            const dateTags = ['citation_publication_date', 'citation_date', 'dc.date', 'date', 'article:published_time', 'parsely-pub-date'];
            for (const tag of dateTags) {
                const val = $(`meta[name="${tag}"], meta[property="${tag}"]`).attr('content');
                if (val) { date = val; break; }
            }
        }

        if (!site) {
            site = $('meta[property="og:site_name"]').attr('content') || 
                   $('meta[name="citation_journal_title"]').attr('content') ||
                   $('meta[name="application-name"]').attr('content');
        }
        
        // URL Fallback for Site
        if (!site) {
            try {
                const hostname = new URL(url).hostname;
                const parts = hostname.replace('www.', '').split('.');
                if (parts.length > 0) site = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
            } catch (e) {}
        }

        // --- 6. CLEANUP ---
        if (author) {
            author = author
                .replace(/Author links open overlay panel/gi, '')
                .replace(/Show more/gi, '')
                .replace(/By\s+/i, '')
                .replace(/\s+and\s+/gi, ', ') // Normalize " and " to comma
                .replace(/^,\s*/, '')
                .trim();
        }
        
        if (date && date.includes('T')) date = date.split('T')[0];

        // --- 7. TEXT EXTRACTION ---
        $('br, div, p, h1, h2, h3, h4, li, tr, span, a, time').after(' ');
        $('script, style, nav, footer, svg, noscript, iframe, aside, .ad, .advertisement, .menu, .navigation, .cookie-banner').remove();
        
        let bodyText = $('body').text().replace(/\s+/g, ' ').trim();

        // --- 8. FINAL REGEX FALLBACK (If all else fails) ---
        if (!author) {
            const authorRegex = /(?:Author|By|Written by)[:\s]+([A-Z][a-z.-]+\s+[A-Z][a-z.-]+(?:,\s+(?:and\s+)?[A-Z][a-z.-]+\s+[A-Z][a-z.-]+|(?:\s+and\s+)[A-Z][a-z.-]+\s+[A-Z][a-z.-]+)*)/i;
            const match = bodyText.substring(0, 1000).match(authorRegex);
            if (match) {
                let clean = match[1].trim();
                clean = clean.replace(/,\s*and$/, '').replace(/\s+and$/, '');
                if (clean.length < 100 && !clean.includes(".")) {
                    author = clean;
                }
            }
        }

        // Date Regex Fallback
        if (!date) {
            const dateRegex = /(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(?:\d{1,2},?\s+)?\d{4}|\d{4}-\d{2}-\d{2}/i;
            const match = bodyText.substring(0, 1000).match(dateRegex);
            if (match) date = match[0];
        }

        // --- 9. CONSTRUCT RICH CONTENT ---
        let richContent = "";
        if (title) richContent += `Title: ${title}. `;
        if (author) richContent += `Author: ${author}. `;
        if (date) richContent += `Date: ${date}. `;
        if (site) richContent += `Source: ${site}. `;
        
        richContent += "\n\n" + bodyText.substring(0, 2000);

        return { 
            url, 
            status: "ok", 
            title: title || "", 
            meta: { 
                author: author || "", 
                date: date || "", 
                site: site || "" 
            }, 
            content: richContent 
        };

      } catch (e) {
        return { url, status: "failed", error: e.message };
      }
    }));

    return res.status(200).json({ results });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
