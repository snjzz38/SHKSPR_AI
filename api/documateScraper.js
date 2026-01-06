import * as cheerio from 'cheerio';

export default async function handler(req, res) {
  // 1. Force CORS Headers (Even on error)
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { urls } = req.body;
    if (!urls || !Array.isArray(urls)) return res.status(400).json({ error: "No URLs provided" });

    // 2. Scrape in Parallel with strict timeout
    const results = await Promise.all(urls.slice(0, 8).map(async (url) => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

        const response = await fetch(url, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DocuMate/1.0)' },
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (!response.ok) throw new Error(`Status ${response.status}`);
        
        const html = await response.text();
        const $ = cheerio.load(html);

        // Extract Meta Tags
        const meta = {
            author: $('meta[name="author"]').attr('content') || $('meta[property="article:author"]').attr('content') || "",
            date: $('meta[name="date"]').attr('content') || $('meta[property="article:published_time"]').attr('content') || "",
            site: $('meta[property="og:site_name"]').attr('content') || ""
        };

        // Clean & Extract Text
        $('script, style, nav, footer, svg, noscript, iframe, header').remove();
        const fullText = $('body').text().replace(/\s+/g, ' ').trim();
        
        // Limit content to save tokens
        const content = fullText.length > 1500 ? fullText.substring(0, 1500) + "..." : fullText;

        return { url, status: "ok", meta, content };

      } catch (e) {
        console.error(`Failed to scrape ${url}: ${e.message}`);
        return { url, status: "failed", error: e.message };
      }
    }));

    return res.status(200).json({ results });

  } catch (error) {
    console.error("Scraper Critical Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
