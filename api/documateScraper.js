import * as cheerio from 'cheerio';

export default async function handler(req, res) {
  // 1. Force CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { urls } = req.body;
    if (!urls || !Array.isArray(urls)) return res.status(400).json({ error: "No URLs provided" });

    // Limit to 10 URLs
    const targetUrls = urls.slice(0, 10);

    const results = await Promise.all(targetUrls.map(async (url) => {
      try {
        // --- A. FETCH METADATA (CiteAs API) ---
        const citeAsPromise = fetch(`https://api.citeas.org/product/${encodeURIComponent(url)}?email=documate@example.com`)
            .then(r => r.ok ? r.json() : null)
            .catch(() => null);

        // --- B. FETCH CONTENT (Scraper) ---
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout
        
        const scrapePromise = fetch(url, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DocuMate/1.0)' },
            signal: controller.signal
        }).then(async (r) => {
            if (!r.ok) throw new Error(`Status ${r.status}`);
            return r.text();
        }).catch(e => null);

        // Wait for both
        const [citeData, html] = await Promise.all([citeAsPromise, scrapePromise]);
        clearTimeout(timeoutId);

        // --- PROCESS SCRAPED HTML ---
        let scrapedMeta = {};
        let content = "";

        if (html) {
            const $ = cheerio.load(html);
            
            // Extract Meta Tags
            scrapedMeta = {
                title: $('h1').first().text().trim() || $('title').text().trim(),
                author: $('meta[name="author"]').attr('content') || $('meta[property="article:author"]').attr('content') || "",
                date: $('meta[name="date"]').attr('content') || $('meta[property="article:published_time"]').attr('content') || "",
                site: $('meta[property="og:site_name"]').attr('content') || ""
            };

            // Clean Text
            $('script, style, nav, footer, svg, noscript, iframe, header, aside').remove();
            const fullText = $('body').text().replace(/\s+/g, ' ').trim();
            content = fullText.substring(0, 1500);
        }

        // --- PROCESS CITEAS DATA ---
        let caAuthor = "";
        let caDate = "";
        let caTitle = "";
        
        if (citeData && citeData.metadata) {
            const m = citeData.metadata;
            caTitle = m.title;
            if (m.author && Array.isArray(m.author)) {
                caAuthor = m.author.map(a => `${a.given || ''} ${a.family || ''}`.trim()).filter(n => n).join(', ');
            }
            if (m.year) caDate = String(m.year);
        }

        // --- MERGE (Priority: CiteAs > Scraper > URL) ---
        const finalMeta = {
            title: caTitle || scrapedMeta.title || "Untitled",
            author: caAuthor || scrapedMeta.author || "",
            date: caDate || scrapedMeta.date || "n.d.",
            site: scrapedMeta.site || new URL(url).hostname.replace('www.', '')
        };

        return { url, status: "ok", meta: finalMeta, content: content || "No content accessible." };

      } catch (e) {
        return { url, status: "failed", error: e.message };
      }
    }));

    return res.status(200).json({ results });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
