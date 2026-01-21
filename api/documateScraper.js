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

    // Limit to 8 to prevent timeouts
    const targetUrls = urls.slice(0, 8);

    const results = await Promise.all(targetUrls.map(async (url) => {
      try {
        // --- 1. FETCH METADATA (CiteAs API) ---
        // This is much better than scraping meta tags
        let citeData = {};
        try {
            const citeRes = await fetch(`https://api.citeas.org/product/${encodeURIComponent(url)}?email=test@example.com`);
            if (citeRes.ok) {
                const json = await citeRes.json();
                // CiteAs returns a list of citations, we usually want the metadata object
                citeData = json.metadata || {};
                // Fallback: try to parse the citation string if metadata is sparse
                if (!citeData.title && json.citations && json.citations.length > 0) {
                    citeData.citationString = json.citations[0].citation;
                }
            }
        } catch (e) { console.warn("CiteAs failed for", url); }

        // --- 2. FETCH CONTENT (Scraping) ---
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        const response = await fetch(url, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DocuMate/1.0)' },
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        let content = "";
        let scrapedMeta = {};

        if (response.ok) {
            const html = await response.text();
            const $ = cheerio.load(html);

            // Fallback Metadata from HTML tags
            scrapedMeta = {
                title: $('h1').first().text().trim() || $('title').text(),
                author: $('meta[name="author"]').attr('content') || "",
                date: $('meta[name="date"]').attr('content') || $('meta[property="article:published_time"]').attr('content') || ""
            };

            // Clean Text
            $('script, style, nav, footer, svg, noscript, iframe, header, aside').remove();
            const fullText = $('body').text().replace(/\s+/g, ' ').trim();
            content = fullText.substring(0, 1500);
        }

        // --- 3. MERGE DATA ---
        // Prefer CiteAs data, fallback to Scraper data
        const finalMeta = {
            title: citeData.title || scrapedMeta.title || "",
            // CiteAs authors are a list of objects {family, given}
            author: citeData.author ? citeData.author.map(a => `${a.given} ${a.family}`).join(', ') : (scrapedMeta.author || ""),
            date: citeData.year ? String(citeData.year) : (scrapedMeta.date || ""),
            site: new URL(url).hostname.replace('www.', '')
        };

        return { url, status: "ok", meta: finalMeta, content };

      } catch (e) {
        return { url, status: "failed", error: e.message };
      }
    }));

    return res.status(200).json({ results });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
