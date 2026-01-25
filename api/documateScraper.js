import * as cheerio from 'cheerio';

export default async function handler(req, res) {
  // 1. CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { urls } = req.body;
    if (!urls || !Array.isArray(urls)) return res.status(400).json({ error: "No URLs provided" });

    // 2. Process URLs (Max 10)
    const results = await Promise.all(urls.slice(0, 10).map(async (url) => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s Timeout

        // A. Fetch HTML
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

        // B. Clean Text
        // Remove non-content elements
        $('script, style, nav, footer, svg, noscript, iframe, aside, .ad, .advertisement, header, .menu, .cookie-banner').remove();
        
        // Extract Title for reference
        const title = $('title').text().trim().substring(0, 150) || 
                      $('h1').first().text().trim() || 
                      "Untitled Source";

        // Extract Body Text
        // Inject spaces after block elements to prevent word merging
        $('br, div, p, h1, h2, h3, h4, li, tr').after(' ');
        
        const bodyText = $('body').text()
            .replace(/\s+/g, ' ') // Collapse whitespace
            .trim()
            .substring(0, 3000); // Limit to 3000 chars to save tokens

        // C. Return ONLY Content (and essentials)
        return { 
            url, 
            status: "ok", 
            title: title,
            content: `TITLE: ${title}\nURL: ${url}\nCONTENT: ${bodyText}` 
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
