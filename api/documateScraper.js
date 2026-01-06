import * as cheerio from 'cheerio';

export default async function handler(req, res) {
  // 1. Force CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // 2. Handle Preflight Request (The Fix)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { urls } = req.body;
    if (!urls || !Array.isArray(urls)) {
        return res.status(400).json({ error: "No URLs provided" });
    }

    // 3. Scrape Logic
    const results = await Promise.all(urls.slice(0, 8).map(async (url) => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        const response = await fetch(url, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DocuMate/1.0)' },
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (!response.ok) throw new Error(`Status ${response.status}`);
        
        const html = await response.text();
        const $ = cheerio.load(html);

        const meta = {
            author: $('meta[name="author"]').attr('content') || "",
            date: $('meta[name="date"]').attr('content') || $('meta[property="article:published_time"]').attr('content') || "",
            site: $('meta[property="og:site_name"]').attr('content') || ""
        };

        $('script, style, nav, footer, svg, noscript, iframe').remove();
        const fullText = $('body').text().replace(/\s+/g, ' ').trim();
        
        // Extract meaningful content
        const content = fullText.length > 500 
            ? fullText.substring(0, 2000) // First 2000 chars
            : fullText;

        return { url, status: "ok", meta, content };

      } catch (e) {
        return { url, status: "failed", error: e.message };
      }
    }));

    return res.status(200).json({ results });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
