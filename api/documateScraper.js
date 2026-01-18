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

        // --- 2. META TAGS ---
        const authors = [];
        $('meta[name="citation_author"]').each((i, el) => {
            const val = $(el).attr('content');
            if (val && !authors.includes(val)) authors.push(val);
        });
        if (authors.length > 0) author = authors.join(', ');

        // --- 3. EXTRACT SITE NAME ---
        site = $('meta[property="og:site_name"]').attr('content') || 
               $('meta[name="citation_journal_title"]').attr('content') ||
               $('meta[name="application-name"]').attr('content');

        // URL Fallback
        if (!site) {
            try {
                const hostname = new URL(url).hostname;
                const parts = hostname.replace('www.', '').split('.');
                if (parts.length > 0) site = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
            } catch (e) {}
        }

        // --- 4. CSS SELECTORS (ScienceDirect Fix) ---
        if (!author) {
            // ScienceDirect often uses .author-group or .authors
            const text = $('.author-group, .authors, .contributors').first().text().trim();
            if (text && text.length > 3) {
                author = text.replace(/\s+/g, ' ').trim();
            }
        }

        // --- 5. EXTRACT DATE ---
        date = $('meta[name="citation_publication_date"]').attr('content') || 
               $('meta[name="citation_date"]').attr('content') || 
               $('meta[name="dc.date"]').attr('content') ||
               $('meta[name="date"]').attr('content') || 
               $('meta[property="article:published_time"]').attr('content');

        // --- 6. CLEANUP & TEXT EXTRACTION ---
        if (author) {
            author = author
                .replace(/Author links open overlay panel/gi, '')
                .replace(/Show more/gi, '')
                .replace(/Get rights and content/gi, '')
                .replace(/Open access/gi, '')
                .replace(/Search/gi, '')
                .replace(/Menu/gi, '')
                .trim();
            author = author.replace(/^,\s*/, '').replace(/^By\s+/i, '');
        }

        $('br, div, p, h1, h2, h3, h4, li, tr, span, a, time').after(' ');
        $('script, style, nav, footer, svg, noscript, iframe, aside, .ad, .advertisement, .menu, .navigation').remove();
        
        let bodyText = $('body').text().replace(/\s+/g, ' ').trim();

        // --- 7. BYLINE OVERRIDE ---
        const bylineRegex = /(?:By|Written by)\s+([A-Z][a-z.-]+\s+[A-Z][a-z.-]+(?:,\s+[A-Z][a-z.-]+\s+[A-Z][a-z.-]+)*)/i;
        const byMatch = bodyText.substring(0, 1500).match(bylineRegex);
        if (byMatch) {
            const textAuthor = byMatch[1].trim();
            const badStarts = ["The", "Contrast", "Comparison", "Definition", "Click", "Subscribe"];
            if (!badStarts.some(b => textAuthor.startsWith(b)) && textAuthor.length < 50) {
                author = textAuthor;
            }
        }

        // --- 8. DATE FALLBACK (Updated Regex) ---
        if (!date) {
            // Matches: "December 2024", "Dec 2024", "December 16, 2025"
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
            meta: { author: author || "", date: date || "", site: site || "" }, 
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
