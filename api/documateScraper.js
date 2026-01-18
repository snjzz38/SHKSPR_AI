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
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(url, { 
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://www.google.com/',
                'Upgrade-Insecure-Requests': '1'
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

        // --- HELPER: Clean Author ---
        const cleanAuthor = (name) => {
            if (!name) return "";
            // Blacklist bad keywords often found in messy metadata
            const badWords = ["TikTok", "Instagram", "Twitter", "Home", "Login", "Search", "Menu", "Skip to", "View PDF"];
            if (badWords.some(w => name.includes(w))) return "";
            return name.trim();
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
                const article = objects.find(o => ['Article', 'NewsArticle', 'BlogPosting', 'Report', 'ScholarlyArticle'].includes(o['@type']));

                if (article) {
                    if (!date && (article.datePublished || article.dateCreated)) date = article.datePublished || article.dateCreated;
                    if (!site && article.publisher) site = (typeof article.publisher === 'string') ? article.publisher : article.publisher.name;
                    // Note: We don't blindly trust JSON-LD author if it might be "HBS TikTok"
                }
            } catch(e) {}
        });

        // --- 3. META TAGS ---
        const authors = [];
        const authorTags = ['citation_author', 'dc.creator', 'author', 'article:author', 'parsely-author', 'sailthru.author'];
        authorTags.forEach(tag => {
            $(`meta[name="${tag}"], meta[property="${tag}"]`).each((i, el) => {
                const val = cleanAuthor($(el).attr('content'));
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
        // URL Fallback
        if (!site) {
            try {
                const hostname = new URL(url).hostname.replace('www.', '');
                site = hostname.split('.')[0].charAt(0).toUpperCase() + hostname.split('.')[0].slice(1);
            } catch (e) {}
        }

        // --- 5. EXTRACT DATE ---
        if (!date) {
            const dateTags = ['citation_publication_date', 'citation_date', 'dc.date', 'date', 'article:published_time', 'parsely-pub-date'];
            for (const tag of dateTags) {
                const val = $(`meta[name="${tag}"], meta[property="${tag}"]`).attr('content');
                if (val) { date = val; break; }
            }
        }

        // --- 6. CLEANUP & TEXT EXTRACTION ---
        $('br, div, p, h1, h2, h3, h4, li, tr, span, a, time').after(' ');
        // Do NOT remove buttons (ScienceDirect)
        $('script, style, nav, footer, svg, noscript, iframe, aside, .ad, .advertisement, .menu, .navigation, .cookie-banner').remove();
        
        let bodyText = $('body').text().replace(/\s+/g, ' ').trim();

        // --- 7. BYLINE OVERRIDE (Fix for HBS/News) ---
        // If the text explicitly says "By [Name]", we prioritize that over metadata (which might be "HBS TikTok")
        const bylineRegex = /(?:By|Written by)\s+([A-Z][a-z.-]+\s+[A-Z][a-z.-]+(?:,\s+(?:and\s+)?[A-Z][a-z.-]+\s+[A-Z][a-z.-]+|(?:\s+and\s+)[A-Z][a-z.-]+\s+[A-Z][a-z.-]+)*)/i;
        const byMatch = bodyText.substring(0, 1500).match(bylineRegex);
        
        if (byMatch) {
            const textAuthor = byMatch[1].trim();
            const badStarts = ["The", "Contrast", "Comparison", "Definition", "Click", "Subscribe"];
            if (!badStarts.some(b => textAuthor.startsWith(b)) && textAuthor.length < 100) {
                // Override if the metadata author looks suspicious or is empty
                if (!author || author.includes("TikTok") || author.includes("HBS")) {
                    author = textAuthor;
                }
            }
        }

        // --- 8. DATE FALLBACK ---
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
