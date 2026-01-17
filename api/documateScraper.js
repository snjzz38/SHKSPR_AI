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

        const response = await fetch(url, { 
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
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

        // --- 1. RELIABLE META TAGS ONLY ---
        // We only take metadata if it's explicitly defined in the HTML.
        // We do NOT guess with Regex anymore.
        
        // Authors (Collect all)
        const authors = [];
        $('meta[name="citation_author"]').each((i, el) => {
            const val = $(el).attr('content');
            if (val && !authors.includes(val)) authors.push(val);
        });
        $('meta[name="dc.creator"]').each((i, el) => {
            const val = $(el).attr('content');
            if (val && !authors.includes(val)) authors.push(val);
        });
        if (authors.length > 0) author = authors.join(', ');

        // Dates
        date = $('meta[name="citation_publication_date"]').attr('content') || 
               $('meta[name="citation_date"]').attr('content') || 
               $('meta[name="dc.date"]').attr('content');

        // Standard Fallbacks
        if (!author) author = $('meta[name="author"]').attr('content');
        if (!date) date = $('meta[name="date"]').attr('content') || $('meta[property="article:published_time"]').attr('content');
        
        site = $('meta[property="og:site_name"]').attr('content') || 
               $('meta[name="citation_journal_title"]').attr('content');

        // JSON-LD (Very reliable for News/Blogs)
        if (!date || !author) {
            $('script[type="application/ld+json"]').each((i, el) => {
                try {
                    const json = JSON.parse($(el).html());
                    const data = Array.isArray(json) ? json[0] : json;
                    
                    if (!date && (data.datePublished || data.dateCreated)) date = data.datePublished || data.dateCreated;
                    if (!author && data.author) {
                        if (typeof data.author === 'string') author = data.author;
                        else if (Array.isArray(data.author)) author = data.author.map(a => a.name || a).join(', ');
                        else if (data.author.name) author = data.author.name;
                    }
                } catch(e) {}
            });
        }

        // --- 2. CLEAN TEXT EXTRACTION ---
        // Inject spaces to prevent word mashing
        $('br, div, p, h1, h2, h3, h4, li, tr').after(' ');
        $('script, style, nav, footer, svg, noscript, iframe, header, aside, button, .ad, .advertisement').remove();
        
        // Clean up whitespace
        let fullText = $('body').text().replace(/\s+/g, ' ').trim();

        // --- 3. CONTIGUOUS CONTENT (The "AI Context" Strategy) ---
        // Instead of skipping around, we grab the first 2000 characters.
        // This almost ALWAYS contains the Title, Author List, Date, and Abstract/Intro.
        // The AI in citation.js is smart enough to parse "By Adib Bin Rashid" from this block.
        const content = fullText.substring(0, 2000);

        return { 
            url, 
            status: "ok", 
            meta: { 
                author: author || "", // Return empty if not found in Meta
                date: date || "", 
                site: site || "" 
            }, 
            content: content 
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
