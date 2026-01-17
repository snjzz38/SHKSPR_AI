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

        // --- 2. JSON-LD EXTRACTION (Deep Search) ---
        $('script[type="application/ld+json"]').each((i, el) => {
            try {
                const json = JSON.parse($(el).html());
                let objects = Array.isArray(json) ? json : (json['@graph'] || [json]);
                
                // Find Article/NewsArticle
                const article = objects.find(o => 
                    ['Article', 'NewsArticle', 'BlogPosting', 'Report', 'ScholarlyArticle'].includes(o['@type'])
                );

                if (article) {
                    if (!date && (article.datePublished || article.dateCreated)) {
                        date = article.datePublished || article.dateCreated;
                    }
                    if (!author && article.author) {
                        if (typeof article.author === 'string') author = article.author;
                        else if (Array.isArray(article.author)) {
                            author = article.author.map(a => a.name || a).join(', ');
                        } else if (article.author.name) {
                            author = article.author.name;
                        }
                    }
                    if (!site && article.publisher) {
                        site = (typeof article.publisher === 'string') ? article.publisher : article.publisher.name;
                    }
                }
            } catch(e) {}
        });

        // --- 3. META TAGS ---
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

        if (!date) {
            const dateTags = ['citation_publication_date', 'citation_date', 'dc.date', 'date', 'article:published_time', 'parsely-pub-date'];
            for (const tag of dateTags) {
                const val = $(`meta[name="${tag}"], meta[property="${tag}"]`).attr('content');
                if (val) { date = val; break; }
            }
        }

        // --- 4. HYPERLINK STRATEGY (Fix for Brookings/News Sites) ---
        // Look for links that contain /author/, /experts/, /people/
        if (!author) {
            const authorLinks = [];
            $('a[href*="/author/"], a[href*="/experts/"], a[href*="/people/"], a[rel="author"]').each((i, el) => {
                const name = $(el).text().trim();
                // Filter out garbage like "View all authors" or empty strings
                if (name && name.length > 2 && name.length < 50 && !name.includes("View") && !name.includes("All")) {
                    if (!authorLinks.includes(name)) authorLinks.push(name);
                }
            });
            if (authorLinks.length > 0) {
                author = authorLinks.join(', ');
            }
        }

        // --- 5. CSS SELECTORS FALLBACK ---
        if (!author) {
            const selectors = ['.author-name', '.byline', '.author', '.contributors', '.article-author', '.entry-author'];
            for (const sel of selectors) {
                const text = $(sel).first().text().trim();
                if (text && text.length > 2 && text.length < 100) {
                    author = text.replace(/\s+/g, ' ').trim();
                    break;
                }
            }
        }

        // --- 6. CLEANUP ---
        if (author) {
            author = author
                .replace(/Author links open overlay panel/gi, '')
                .replace(/Show more/gi, '')
                .replace(/By\s+/i, '')
                .replace(/^,\s*/, '')
                .trim();
        }
        
        if (date && date.includes('T')) date = date.split('T')[0];

        if (!site) {
            site = $('meta[property="og:site_name"]').attr('content') || 
                   $('meta[name="citation_journal_title"]').attr('content') ||
                   $('meta[name="application-name"]').attr('content');
        }

        // --- 7. TEXT EXTRACTION ---
        $('br, div, p, h1, h2, h3, h4, li, tr, span, a, time').after(' ');
        $('script, style, nav, footer, svg, noscript, iframe, aside, .ad, .advertisement, .menu, .navigation, .cookie-banner').remove();
        
        let bodyText = $('body').text().replace(/\s+/g, ' ').trim();

        // --- 8. FINAL REGEX FALLBACK ---
        if (!author) {
            const byMatch = bodyText.substring(0, 500).match(/By\s*([A-Z][a-z]+\s[A-Z][a-z]+)/);
            if (byMatch) author = byMatch[1];
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
