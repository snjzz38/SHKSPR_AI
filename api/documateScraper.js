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

    const results = await Promise.all(urls.slice(0, 8).map(async (url) => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);

        const response = await fetch(url, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DocuMate/1.0)' },
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (!response.ok) throw new Error(`Status ${response.status}`);
        
        const html = await response.text();
        const $ = cheerio.load(html);

        // 1. Robust Metadata Extraction
        let author = $('meta[name="author"]').attr('content') || 
                     $('meta[property="article:author"]').attr('content') || 
                     $('meta[name="citation_author"]').attr('content') || 
                     $('meta[name="dc.creator"]').attr('content') || "";

        let date = $('meta[name="date"]').attr('content') || 
                   $('meta[property="article:published_time"]').attr('content') || 
                   $('meta[name="citation_publication_date"]').attr('content') || 
                   $('time').first().text().trim() || "";

        const site = $('meta[property="og:site_name"]').attr('content') || "";

        // 2. Try JSON-LD (Structured Data) if meta failed
        if (!author || !date) {
            try {
                $('script[type="application/ld+json"]').each((i, el) => {
                    const data = JSON.parse($(el).html());
                    if (data['@type'] === 'NewsArticle' || data['@type'] === 'Article' || data['@type'] === 'BlogPosting') {
                        if (!author && data.author) {
                            author = typeof data.author === 'object' ? data.author.name : data.author;
                        }
                        if (!date && data.datePublished) {
                            date = data.datePublished;
                        }
                    }
                });
            } catch (e) {}
        }

        // 3. Clean Text (Keep Header this time)
        $('script, style, nav, footer, svg, noscript, iframe').remove();
        const fullText = $('body').text().replace(/\s+/g, ' ').trim();
        const content = fullText.substring(0, 2500); // Increased limit

        return { url, status: "ok", meta: { author, date, site }, content };

      } catch (e) {
        return { url, status: "failed", error: e.message };
      }
    }));

    return res.status(200).json({ results });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
