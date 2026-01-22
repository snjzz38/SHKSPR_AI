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

    // Limit to 8 URLs for speed
    const targetUrls = urls.slice(0, 8);

    const results = await Promise.all(targetUrls.map(async (url) => {
      try {
        // --- PARALLEL REQUESTS: Metadata (CiteAs) + Content (Scraper) ---
        const [citeAsData, pageContent] = await Promise.all([
            fetchCiteAsMetadata(url),
            fetchPageContent(url)
        ]);

        // --- MERGE DATA ---
        // Priority: CiteAs > Scraped Meta > Fallback
        const finalMeta = {
            title: citeAsData.title || pageContent.meta.title || "Untitled",
            author: citeAsData.author || pageContent.meta.author || "Unknown",
            date: citeAsData.date || pageContent.meta.date || "n.d.",
            site: citeAsData.site || pageContent.meta.site || new URL(url).hostname.replace('www.', '')
        };

        return { 
            url, 
            status: "ok", 
            meta: finalMeta, 
            content: pageContent.text // Needed for Quotes
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

// --- HELPER: Fetch Metadata from CiteAs ---
async function fetchCiteAsMetadata(url) {
    try {
        // Use a generic email for the API tracking
        const apiUrl = `https://api.citeas.org/product/${encodeURIComponent(url)}?email=documate@example.com`;
        const res = await fetch(apiUrl);
        if (!res.ok) return {};
        
        const json = await res.json();
        const m = json.metadata || {};
        
        // 1. Format Author
        let authorStr = "";
        if (m.author && Array.isArray(m.author)) {
            // CiteAs returns {family: "Smith", given: "John"}
            authorStr = m.author.map(a => {
                const name = `${a.given || ''} ${a.family || ''}`.trim();
                return name || a.family || ""; // Fallback if given name missing
            }).filter(n => n).join(', ');
        }

        // 2. Format Date
        let dateStr = "";
        if (m.year) dateStr = String(m.year);

        // 3. Format Site/Container
        let siteStr = m.container_title || m.publisher || "";

        return {
            title: m.title,
            author: authorStr,
            date: dateStr,
            site: siteStr
        };
    } catch (e) {
        return {}; // Fail silently, fallback to scraper
    }
}

// --- HELPER: Fetch Content via Cheerio ---
async function fetchPageContent(url) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000); // 4s timeout

        const response = await fetch(url, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DocuMate/1.0)' },
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (!response.ok) return { text: "", meta: {} };
        
        const html = await response.text();
        const $ = cheerio.load(html);

        // Extract Fallback Metadata
        const meta = {
            title: $('h1').first().text().trim() || $('title').text().trim(),
            author: $('meta[name="author"]').attr('content') || $('meta[property="article:author"]').attr('content') || "",
            date: $('meta[name="date"]').attr('content') || $('meta[property="article:published_time"]').attr('content') || "",
            site: $('meta[property="og:site_name"]').attr('content') || ""
        };

        // Extract Text
        $('script, style, nav, footer, svg, noscript, iframe, header, aside').remove();
        const fullText = $('body').text().replace(/\s+/g, ' ').trim();
        const text = fullText.substring(0, 1500); // Limit for AI context

        return { text, meta };
    } catch (e) {
        return { text: "", meta: {} };
    }
}
