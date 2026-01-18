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
                const article = objects.find(o => ['Article', 'NewsArticle', 'BlogPosting', 'Report', 'ScholarlyArticle'].includes(o['@type']));

                if (article) {
                    if (!date && (article.datePublished || article.dateCreated)) date = article.datePublished || article.dateCreated;
                    if (!site && article.publisher) site = (typeof article.publisher === 'string') ? article.publisher : article.publisher.name;
                    // We don't set author here immediately to allow multi-strategy collection below
                }
            } catch(e) {}
        });

        // --- 3. META TAGS ---
        const authors = [];
        const authorTags = ['citation_author', 'dc.creator', 'author', 'article:author', 'parsely-author', 'sailthru.author'];
        authorTags.forEach(tag => {
            $(`meta[name="${tag}"], meta[property="${tag}"]`).each((i, el) => {
                const val = $(el).attr('content');
                if (val && !authors.includes(val)) authors.push(val);
            });
        });
        if (authors.length > 0) author = authors.join(', ');

        // --- 4. EXTRACT SITE NAME ---
        if (!site) {
            site = $('meta[property="og:site_name"]').attr('content') || 
                   $('meta[name="citation_journal_title"]').attr('content') ||
                   $('meta[name="application-name"]').attr('content');
        }

        // URL Fallback for Site
        if (!site) {
            try {
                const hostname = new URL(url).hostname;
                if (hostname.includes('substack.com')) {
                    const subdomain = hostname.split('.')[0];
                    site = subdomain.charAt(0).toUpperCase() + subdomain.slice(1) + " Substack";
                } else {
                    const parts = hostname.replace('www.', '').split('.');
                    if (parts.length > 0) site = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
                }
            } catch (e) {}
        }

        // --- 5. GENERIC AUTHOR CHECK ---
        // If author is same as site (e.g. "ABC News"), clear it to force text fallback
        if (author && site && author.toLowerCase().trim() === site.toLowerCase().trim()) {
            author = "";
        }

        // --- 6. HYPERLINK STRATEGY (Brookings/News) ---
        if (!author) {
            const collectedAuthors = new Set();
            const badNames = ["Experts", "People", "Authors", "Contributors", "View all", "All", "Search", "Menu", "Home", "About", "Log in", "Sign up"];
            
            $('a[href*="/author/"], a[href*="/experts/"], a[href*="/people/"], a[rel="author"]').each((i, el) => {
                const name = $(el).text().trim();
                if (name && name.length > 2 && name.length < 50 && !badNames.includes(name)) {
                    collectedAuthors.add(name);
                }
            });
            if (collectedAuthors.size > 0) author = Array.from(collectedAuthors).join(', ');
        }

        // --- 7. LABEL-VALUE STRATEGY (UNH/CMS) ---
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

        // --- 8. EXTRACT DATE ---
        if (!date) {
            const dateTags = ['citation_publication_date', 'citation_date', 'dc.date', 'date', 'article:published_time', 'parsely-pub-date'];
            for (const tag of dateTags) {
                const val = $(`meta[name="${tag}"], meta[property="${tag}"]`).attr('content');
                if (val) { date = val; break; }
            }
        }

        // --- 9. CLEANUP & TEXT EXTRACTION ---
        if (author) {
            author = author
                .replace(/Author links open overlay panel/gi, '')
                .replace(/Show more/gi, '')
                .replace(/By\s+/i, '')
                .replace(/^,\s*/, '')
                .trim();
        }
        if (date && date.includes('T')) date = date.split('T')[0];

        // Inject spaces
        $('br, div, p, h1, h2, h3, h4, li, tr, span, a, time').after(' ');
        // CRITICAL: Do NOT remove buttons (ScienceDirect authors are in buttons)
        $('script, style, nav, footer, svg, noscript, iframe, aside, .ad, .advertisement, .menu, .navigation, .cookie-banner').remove();
        
        let bodyText = $('body').text().replace(/\s+/g, ' ').trim();

        // --- 10. FINAL REGEX FALLBACKS ---
        
        // Author: "By Name, Name, and Name"
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

        // Date: "Nov 27, 2024" or "November 27, 2024"
        if (!date) {
            const dateRegex = /(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2}/i;
            const match = bodyText.substring(0, 1000).match(dateRegex);
            if (match) date = match[0];
        }

        // --- 11. CONSTRUCT RICH CONTENT ---
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
