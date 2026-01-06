import * as cheerio from 'cheerio';

export default async function handler(req, res) {
  // 1. Force Headers (Backup to vercel.json)
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // 2. Handle Preflight
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { urls } = req.body;
    
    if (!urls || !Array.isArray(urls)) {
        return res.status(400).json({ error: "No URLs provided" });
    }

    // 3. Scrape in Parallel (Limit 8)
    const results = await Promise.all(urls.slice(0, 8).map(async (url) => {
      try {
        // Fetch with timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000); // 4s timeout

        const response = await fetch(url, { 
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' 
            },
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (!response.ok) throw new Error(`Status ${response.status}`);
        
        const html = await response.text();
        const $ = cheerio.load(html);

        // Extract Metadata
        const meta = {
            author: $('meta[name="author"]').attr('content') || $('meta[property="article:author"]').attr('content') || "",
            date: $('meta[name="date"]').attr('content') || $('meta[property="article:published_time"]').attr('content') || "",
            site: $('meta[property="og:site_name"]').attr('content') || ""
        };

        // Clean Text
        $('script, style, nav, footer, svg, noscript, iframe').remove();
        const fullText = $('body').text().replace(/\s+/g, ' ').trim();
        const words = fullText.split(' ');

        // Truncate
        let content = "";
        if (words.length < 500) {
            content = fullText;
        } else {
            const start = words.slice(0, 400).join(' ');
            const end = words.slice(-100).join(' ');
            content = `${start} ... [SECTION SKIPPED] ... ${end}`;
        }

        return { url, status: "ok", meta, content };

      } catch (e) {
        // Return failed object instead of crashing
        return { url, status: "failed", error: e.message };
      }
    }));

    return res.status(200).json({ results });

  } catch (error) {
    console.error("Scraper Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
