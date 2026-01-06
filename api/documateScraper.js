// api/documateScraper.js
import * as cheerio from 'cheerio';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { urls } = req.body;
    if (!urls || !Array.isArray(urls)) return res.status(400).json({ error: "No URLs provided" });

    // Scrape in parallel (limit to 8 to prevent timeouts)
    const results = await Promise.all(urls.slice(0, 8).map(async (url) => {
      try {
        const response = await fetch(url, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DocuMateBot/1.0)' },
            signal: AbortSignal.timeout(4000) // 4s timeout per page
        });
        
        if (!response.ok) throw new Error("Failed to load");
        const html = await response.text();
        const $ = cheerio.load(html);

        // 1. Extract Metadata (High Accuracy for Citations)
        const meta = {
            author: $('meta[name="author"]').attr('content') || $('meta[property="article:author"]').attr('content') || "",
            date: $('meta[name="date"]').attr('content') || $('meta[property="article:published_time"]').attr('content') || "",
            site: $('meta[property="og:site_name"]').attr('content') || ""
        };

        // 2. Clean Text
        $('script, style, nav, footer, svg, noscript').remove();
        const fullText = $('body').text().replace(/\s+/g, ' ').trim();
        const words = fullText.split(' ');

        // 3. Extract First 400 and Last 100 words
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
        return { url, status: "failed", error: e.message };
      }
    }));

    return res.status(200).json({ results });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
