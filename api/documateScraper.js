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
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
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

        // --- 1. ACADEMIC META TAGS (Collect ALL authors) ---
        const authors = [];
        $('meta[name="citation_author"]').each((i, el) => {
            const val = $(el).attr('content');
            if (val && !authors.includes(val)) authors.push(val);
        });
        $('meta[name="dc.creator"]').each((i, el) => {
            const val = $(el).attr('content');
            if (val && !authors.includes(val)) authors.push(val);
        });

        if (authors.length > 0) {
            author = authors.join(', ');
        }

        // Dates
        date = $('meta[name="citation_publication_date"]').attr('content') || 
               $('meta[name="citation_date"]').attr('content') || 
               $('meta[name="dc.date"]').attr('content');

        // --- 2. STANDARD META TAGS ---
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

        // --- 3. JSON-LD (Rich Snippets) ---
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
                        else if (Array.isArray(data.author)) {
                            author = data.author.map(a => a.name).join(', ');
                        }
                    }
                } catch(e) {}
            });
        }

        // Cleanup Content
        $('script, style, nav, footer, svg, noscript, iframe, header, aside').remove();
        const fullText = $('body').text().replace(/\s+/g, ' ').trim();

        // --- 4. TEXT FALLBACKS (If Meta Failed) ---
        
        // Author Fallback: Look for "Authors: ..." or "Written by ..."
        if (!author) {
            const authorRegex = /(?:Authors?|Written by)[:\s]+([A-Z][a-z]+(?:\s[A-Z][a-z]+){1,3}(?:,\s[A-Z][a-z]+(?:\s[A-Z][a-z]+){1,3})*)/i;
            const match = fullText.substring(0, 500).match(authorRegex);
            if (match) author = match[1];
        }

        // Date Fallback: Regex search in text
        if (!date) {
            const dateRegex = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}|(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}|\d{4}-\d{2}-\d{2}/i;
            const match = fullText.substring(0, 800).match(dateRegex);
            if (match) date = match[0];
        }

        // --- 5. VARIED CONTENT EXTRACTION ---
        // Extract chunks: 100-300, 500-700, 800-1000
        let contentChunks = [];
        const ranges = [[100, 300], [500, 700], [800, 1000]];
        
        ranges.forEach(([start, end]) => {
            if (fullText.length > start) {
                // Ensure we don't go out of bounds
                const actualEnd = Math.min(fullText.length, end);
                const chunk = fullText.substring(start, actualEnd).trim();
                if (chunk.length > 20) { // Only add substantial chunks
                    contentChunks.push(chunk);
                }
            }
        });

        // If text is very short, just take what we have
        if (contentChunks.length === 0) {
            contentChunks.push(fullText.substring(0, 500));
        }

        const finalContent = contentChunks.join(" ... ");

        return { 
            url, 
            status: "ok", 
            meta: { 
                author: author || "", 
                date: date || "", 
                site: site || "" 
            }, 
            content: finalContent
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
