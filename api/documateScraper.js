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
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout for slow gov sites

        // --- 1. ROBUST HEADERS (Fixes 403 Forbidden) ---
        const response = await fetch(url, { 
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://www.google.com/',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'cross-site'
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

        // --- 2. EXTRACT TITLE ---
        title = $('meta[property="og:title"]').attr('content') || 
                $('meta[name="twitter:title"]').attr('content') || 
                $('h1').first().text().trim() || 
                $('title').text().trim();

        // --- 3. JSON-LD EXTRACTION ---
        $('script[type="application/ld+json"]').each((i, el) => {
            try {
                const json = JSON.parse($(el).html());
                let objects = Array.isArray(json) ? json : (json['@graph'] || [json]);
                
                const article = objects.find(o => 
                    ['Article', 'NewsArticle', 'BlogPosting', 'Report', 'ScholarlyArticle', 'WebPage'].includes(o['@type'])
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

        // --- 4. META TAGS ---
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

        // --- 5. EXTRACT SITE NAME ---
        if (!site) {
            site = $('meta[property="og:site_name"]').attr('content') || 
                   $('meta[name="citation_journal_title"]').attr('content') ||
                   $('meta[name="application-name"]').attr('content');
        }

        // URL Fallback for Site Name (Clean)
        if (!site) {
            try {
                const hostname = new URL(url).hostname.replace('www.', '');
                if (hostname.includes('parliament.uk')) site = "UK Parliament";
                else if (hostname.includes('wikipedia.org')) site = "Wikipedia";
                else site = hostname.split('.')[0].charAt(0).toUpperCase() + hostname.split('.')[0].slice(1);
            } catch (e) {}
        }

        // --- 6. HYPERLINK STRATEGY ---
        if (!author) {
            const collectedAuthors = new Set();
            const badNames = ["Experts", "People", "Authors", "Contributors", "View all", "All", "Search", "Menu", "Home", "About", "Log in", "Sign up", "Share"];
            
            $('a[href*="/author/"], a[href*="/experts/"], a[href*="/people/"], a[href*="/profile/"], a[rel="author"]').each((i, el) => {
                const name = $(el).text().trim();
                if (name && name.length > 2 && name.length < 50 && !badNames.includes(name)) {
                    collectedAuthors.add(name);
                }
            });
            if (collectedAuthors.size > 0) author = Array.from(collectedAuthors).join(', ');
        }

        // --- 7. LABEL-VALUE STRATEGY ---
        if (!author) {
            $('*').each((i, el) => {
                if (author) return;
                const text = $(el).clone().children().remove().end().text().trim().toUpperCase();
                if (text === 'AUTHOR' || text === 'AUTHOR:' || text === 'WRITTEN BY') {
                    let next = $(el).next();
                    if (next.length && next.text().trim().length > 2) {
                        author = next.text().trim();
                        return;
                    }
                    let parentNext = $(el).parent().next();
                    if (parentNext.length && parentNext.text().trim().length > 2) {
                        author = parentNext.text().trim();
                        return;
                    }
                }
            });
        }

        // --- 8. CLEANUP & TEXT EXTRACTION ---
        if (author) {
            author = author
                .replace(/Author links open overlay panel/gi, '')
                .replace(/links open/gi, '')
                .replace(/Show more/gi, '')
                .replace(/By\s+/i, '')
                .replace(/^,\s*/, '')
                .trim();
        }
        
        // WIKIPEDIA FIX: Remove "Wikipedia Contributors"
        if (url.includes('wikipedia.org') || site === 'Wikipedia') {
            author = ""; // Force empty so citation uses "Wikipedia" or Title
        }

        if (date && date.includes('T')) date = date.split('T')[0];

        $('br, div, p, h1, h2, h3, h4, li, tr, span, a, time').after(' ');
        $('script, style, nav, footer, svg, noscript, iframe, aside, .ad, .advertisement, .menu, .navigation, .cookie-banner').remove();
        
        let bodyText = $('body').text().replace(/\s+/g, ' ').trim();

        // --- 9. FINAL REGEX FALLBACKS ---
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

        if (!date) {
            const dateRegex = /(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(?:\d{1,2},?\s+)?\d{4}|\d{4}-\d{2}-\d{2}/i;
            const match = bodyText.substring(0, 1000).match(dateRegex);
            if (match) date = match[0];
        }

        // --- 10. CONSTRUCT RICH CONTENT ---
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
