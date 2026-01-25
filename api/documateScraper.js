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
        // 8 Second Timeout - Fast enough to avoid Vercel limits, slow enough for most sites
        const timeoutId = setTimeout(() => controller.abort(), 8000); 

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

        // B. Clean Text (Aggressive Cleaning)
        $('script, style, nav, footer, svg, noscript, iframe, aside, .ad, .advertisement, header, .menu, .cookie-banner, .popup').remove();
        
        // Extract Title
        const title = $('title').text().trim().substring(0, 200) || 
                      $('h1').first().text().trim() || 
                      "Untitled Source";

        // Extract Body
        // Inject spaces to separate blocks
        $('br, div, p, h1, h2, h3, h4, li, tr').after(' ');
        
        const bodyText = $('body').text()
            .replace(/\s+/g, ' ') // Collapse multiple spaces
            .trim()
            .substring(0, 3500); // Limit to ~3500 chars for the LLM

        // C. Return Content-Only
        // We pack everything into 'content' so Groq can parse it.
        return { 
            url, 
            status: "ok", 
            title: title,
            content: `TITLE: ${title}\nURL: ${url}\nCONTENT: ${bodyText}` 
        };

      } catch (e) {
        // Return failed status instead of crashing
        return { url, status: "failed", error: e.message };
      }
    }));

    return res.status(200).json({ results });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
