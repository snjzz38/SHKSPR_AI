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

    // Limit to 6 URLs for speed
    const targetUrls = urls.slice(0, 6);

    const results = await Promise.all(targetUrls.map(async (url) => {
      try {
        const controller = new AbortController();
        // 4 second timeout is plenty for a citation check
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        const response = await fetch(url, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DocuMate/1.0)' },
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (!response.ok) throw new Error(`Status ${response.status}`);
        
        const html = await response.text();
        const $ = cheerio.load(html);

        // 1. Better Title Extraction (Fixes Truncation)
        // H1 is usually the full article title on the page, unlike meta tags which get cut off.
        const h1 = $('h1').first().text().trim();
        const ogTitle = $('meta[property="og:title"]').attr('content');
        const metaTitle = $('title').text();
        
        // Prioritize H1 -> OG -> Title Tag
        const bestTitle = h1 && h1.length > 10 ? h1 : (ogTitle || metaTitle || "");

        // 2. Metadata
        const meta = {
            title: bestTitle, // Send this back explicitly
            author: $('meta[name="author"]').attr('content') || $('meta[property="article:author"]').attr('content') || "",
            date: $('meta[name="date"]').attr('content') || $('meta[property="article:published_time"]').attr('content') || "",
            site: $('meta[property="og:site_name"]').attr('content') || ""
        };

        // 3. Clean & Limit Text (Speed Optimization)
        $('script, style, nav, footer, svg, noscript, iframe, header, aside').remove();
        const fullText = $('body').text().replace(/\s+/g, ' ').trim();
        
        // Reduce to 1000 chars (approx 150-200 words). 
        // This is enough for a citation check and drastically reduces AI processing time.
        const content = fullText.substring(0, 1000);

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
