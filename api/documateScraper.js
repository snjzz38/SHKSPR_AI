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

        // --- HELPER: Validate Name ---
        const isValidName = (name) => {
            const badNames = ["Experts", "People", "Authors", "Contributors", "View all", "All", "Search", "Menu", "Home", "About", "Log in", "Sign up", "Share", "Follow", "Twitter", "Facebook"];
            return name && name.length > 2 && name.length < 50 && !badNames.includes(name) && !name.includes("...");
        };

        // --- 1. EXTRACT TITLE ---
        title = $('meta[property="og:title"]').attr('content') || 
                $('meta[name="twitter:title"]').attr('content') || 
                $('h1').first().text().trim() || 
                $('title').text().trim();

        // --- 2. JSON-LD EXTRACTION ---
        $('script[type="application/ld+json"]').each((i, el) => {
            try {
                const json = JSON.parse($(el).html());
                let objects = Array.isArray(json) ? json : (json['@graph'] || [json]);
                
                const article = objects.find(o => 
                    ['Article', 'NewsArticle', 'BlogPosting', 'Report', 'ScholarlyArticle'].includes(o['@type'])
                );

                if (article) {
                    if (!date && (article.datePublished || article.dateCreated)) {
                        date = article.datePublished || article.dateCreated;
                    }
                    if (!site && article.publisher) {
                        site = (typeof article.publisher === 'string') ? article.publisher : article.publisher.name;
                    }
                }
            } catch(e) {}
        });

        // --- 3. META TAGS (Date/Site) ---
        if (!date) {
            const dateTags = ['citation_publication_date', 'citation_date', 'dc.date', 'date', 'article:published_time', 'parsely-pub-date'];
            for (const tag of dateTags) {
                const val = $(`meta[name="${tag}"], meta[property="${tag}"]`).attr('content');
                if (val) { date = val; break; }
            }
        }

        // --- 4. AUTHOR EXTRACTION (Multi-Strategy) ---
        let collectedAuthors = new Set();

        // Strategy A: Explicit Meta Tags
        const authorTags = ['citation_author', 'dc.creator', 'author', 'article:author', 'parsely-author', 'sailthru.author'];
        authorTags.forEach(tag => {
            $(`meta[name="${tag}"], meta[property="${tag}"]`).each((i, el) => {
                const val = $(el).attr('content');
                if (isValidName(val)) collectedAuthors.add(val);
            });
        });

        // Strategy B: Hyperlinks & IDs (Enhanced for Brookings)
        // 1. Look for URL patterns
        $('a[href*="/author/"], a[href*="/experts/"], a[href*="/people/"], a[rel="author"]').each((i, el) => {
            const name = $(el).text().trim();
            if (isValidName(name)) collectedAuthors.add(name);
        });

        // 2. Look for ID/Class patterns (Fix for 'person-hover-1', 'person-hover-2')
        $('a[id^="person-"], a[class*="person-"], a[class*="author-"], .author a, .byline a').each((i, el) => {
             const name = $(el).text().trim();
             if (isValidName(name)) collectedAuthors.add(name);
        });

        // Strategy C: JSON-LD (Fallback)
        if (collectedAuthors.size === 0) {
             $('script[type="application/ld+json"]').each((i, el) => {
                try {
                    const json = JSON.parse($(el).html());
                    let objects = Array.isArray(json) ? json : (json['@graph'] || [json]);
                    const article = objects.find(o => ['Article', 'NewsArticle'].includes(o['@type']));
                    if (article && article.author) {
                        if (typeof article.author === 'string') collectedAuthors.add(article.author);
                        else if (Array.isArray(article.author)) article.author.forEach(a => collectedAuthors.add(a.name || a));
                        else if (article.author.name) collectedAuthors.add(article.author.name);
                    }
                } catch(e) {}
            });
        }

        // Strategy D: CSS Selectors (Last Resort)
        if (collectedAuthors.size === 0) {
            const selectors = ['.author-name', '.byline', '.author', '.contributors', '.article-author', '.entry-author'];
            for (const sel of selectors) {
                const text = $(sel).first().text().trim();
                if (isValidName(text)) {
                    collectedAuthors.add(text.replace(/\s+/g, ' ').trim());
                    break;
                }
            }
        }

        // Combine Authors
        if (collectedAuthors.size > 0) {
            author = Array.from(collectedAuthors).join(', ');
        }

        // --- 5. CLEANUP ---
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

        // --- 6. TEXT EXTRACTION ---
        $('br, div, p, h1, h2, h3, h4, li, tr, span, a, time').after(' ');
        $('script, style, nav, footer, svg, noscript, iframe, aside, .ad, .advertisement, .menu, .navigation, .cookie-banner').remove();
        
        let bodyText = $('body').text().replace(/\s+/g, ' ').trim();

        // --- 7. FINAL REGEX FALLBACK ---
        if (!author) {
            const byMatch = bodyText.substring(0, 500).match(/By\s*([A-Z][a-z]+\s[A-Z][a-z]+)/);
            if (byMatch) author = byMatch[1];
        }

        // --- 8. CONSTRUCT RICH CONTENT ---
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
