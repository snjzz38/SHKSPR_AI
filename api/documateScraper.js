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

    const results = await Promise.all(urls.slice(0, 10).map(async (url) => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);

        // Use a generic User-Agent to avoid blocking
        const response = await fetch(url, { 
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36' 
            },
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (!response.ok) throw new Error(`Status ${response.status}`);
        
        const html = await response.text();
        const $ = cheerio.load(html);

        let author = "";
        let date = "";
        let site = "";

        // --- STRATEGY 1: ACADEMIC META TAGS (ScienceDirect, JSTOR, etc.) ---
        author = $('meta[name="citation_author"]').first().attr('content') || 
                 $('meta[name="dc.creator"]').attr('content');
        
        date = $('meta[name="citation_publication_date"]').attr('content') || 
               $('meta[name="citation_date"]').attr('content') || 
               $('meta[name="dc.date"]').attr('content');

        // --- STRATEGY 2: STANDARD META TAGS ---
        if (!author) {
            author = $('meta[name="author"]').attr('content') || 
                     $('meta[property="article:author"]').attr('content');
        }
        if (!date) {
            date = $('meta[name="date"]').attr('content') || 
                   $('meta[property="article:published_time"]').attr('content') || 
                   $('meta[name="publish-date"]').attr('content');
        }
        
        site = $('meta[property="og:site_name"]').attr('content') || 
               $('meta[name="citation_journal_title"]').attr('content');

        // --- STRATEGY 3: JSON-LD (Rich Snippets) ---
        if (!date || !author) {
            $('script[type="application/ld+json"]').each((i, el) => {
                try {
                    const json = JSON.parse($(el).html());
                    const data = Array.isArray(json) ? json[0] : json;
                    
                    if (!date && (data.datePublished || data.dateCreated)) {
                        date = data.datePublished || data.dateCreated;
                    }
                    if (!author && data.author) {
                        if (typeof data.author === 'string') author = data.author;
                        else if (data.author.name) author = data.author.name;
                        else if (Array.isArray(data.author) && data.author[0].name) author = data.author[0].name;
                    }
                } catch(e) {}
            });
        }

        // Cleanup Content
        $('script, style, nav, footer, svg, noscript, iframe, header, aside').remove();
        const fullText = $('body').text().replace(/\s+/g, ' ').trim();

        // --- STRATEGY 4: REGEX FALLBACK (Find date in text) ---
        // If date is still missing, look for patterns like "December 2024" or "2024-12-01" in the first 500 chars
        if (!date) {
            const dateRegex = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}|(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}|\d{4}-\d{2}-\d{2}/i;
            const match = fullText.substring(0, 800).match(dateRegex);
            if (match) {
                date = match[0];
            }
        }

        return { 
            url, 
            status: "ok", 
            meta: { 
                author: author || "", 
                date: date || "", 
                site: site || "" 
            }, 
            content: fullText.substring(0, 1500) 
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
