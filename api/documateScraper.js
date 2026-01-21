import * as cheerio from 'cheerio';

export default async function handler(req, res) {
  // 1. Force CORS Headers (Must happen first)
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // 2. Handle Preflight
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // 3. Validate Request
    const { urls } = req.body;
    if (!urls || !Array.isArray(urls)) {
        return res.status(400).json({ error: "No URLs provided" });
    }

    // 4. Scrape in Parallel (Limit 10)
    // We catch errors INSIDE the map so one bad URL doesn't crash the whole function
    const results = await Promise.all(urls.slice(0, 10).map(async (url) => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout per page

        const response = await fetch(url, { 
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' 
            },
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const html = await response.text();
        const $ = cheerio.load(html);

        // Extract Metadata
        const meta = {
            title: $('h1').first().text().trim() || $('title').text() || "",
            author: $('meta[name="author"]').attr('content') || $('meta[property="article:author"]').attr('content') || "",
            date: $('meta[name="date"]').attr('content') || $('meta[property="article:published_time"]').attr('content') || "",
            site: $('meta[property="og:site_name"]').attr('content') || ""
        };

        // Clean Text
        $('script, style, nav, footer, svg, noscript, iframe, header, aside').remove();
        const fullText = $('body').text().replace(/\s+/g, ' ').trim();
        const content = fullText.substring(0, 1500); // Limit to 1500 chars

        return { url, status: "ok", meta, content };

      } catch (e) {
        // Return failed status instead of crashing
        return { url, status: "failed", error: e.message };
      }
    }));

    return res.status(200).json({ results });

  } catch (error) {
    console.error("Scraper Critical Error:", error);
    // Return 200 with error info so frontend handles it gracefully
    return res.status(200).json({ results: [], error: error.message });
  }
}
