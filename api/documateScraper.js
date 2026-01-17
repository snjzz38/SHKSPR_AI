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

        // --- 1. META TAGS (Academic & Standard) ---
        const authors = [];
        // ScienceDirect / Academic
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

        // Standard Fallbacks
        if (!author) author = $('meta[name="author"]').attr('content');
        if (!date) date = $('meta[name="date"]').attr('content') || $('meta[property="article:published_time"]').attr('content');
        
        site = $('meta[property="og:site_name"]').attr('content') || 
               $('meta[name="citation_journal_title"]').attr('content');

        // --- 2. JSON-LD EXTRACTION ---
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
                        else if (Array.isArray(data.author)) {
                            author = data.author.map(a => a.name || a).join(', ');
                        } else if (data.author.name) {
                            author = data.author.name;
                        }
                    }
                } catch(e) {}
            });
        }

        // --- 3. TEXT PRE-PROCESSING (Fix Mashed Text) ---
        // Inject spaces after block elements so "contentSkip" becomes "content Skip"
        $('br, div, p, h1, h2, h3, h4, li, tr').after(' ');
        $('script, style, nav, footer, svg, noscript, iframe, header, aside, button, .ad, .advertisement').remove();
        
        const fullText = $('body').text().replace(/\s+/g, ' ').trim();

        // --- 4. SCIENCEDIRECT SPECIFIC HACK ---
        // ScienceDirect puts authors right after "Author links open overlay panel"
        if (!author && fullText.includes("Author links open overlay panel")) {
            const parts = fullText.split("Author links open overlay panel");
            if (parts[1]) {
                // Take text until "Show more" or "Get rights"
                const potentialAuthors = parts[1].split(/Show more|Get rights|Abstract/)[0].trim();
                if (potentialAuthors.length > 3 && potentialAuthors.length < 100) {
                    author = potentialAuthors;
                }
            }
        }

        // --- 5. GENERIC TEXT FALLBACKS ---
        if (!author) {
            // Look for "By [Name]"
            const byMatch = fullText.substring(0, 500).match(/By\s+([A-Z][a-z]+\s[A-Z][a-z]+)/);
            if (byMatch) author = byMatch[1];
        }

        if (!date) {
            const dateRegex = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}|(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}|\d{4}-\d{2}-\d{2}/i;
            const match = fullText.substring(0, 800).match(dateRegex);
            if (match) date = match[0];
        }

        // --- 6. BAD AUTHOR FILTER ---
        // If the "author" we found is actually UI text, kill it.
        const badWords = ["Search", "Skip", "Login", "Sign in", "Menu", "Home", "PDF", "View", "Download"];
        if (author && badWords.some(w => author.includes(w))) {
            author = ""; // Reset if it contains garbage
        }

        // --- 7. SKIP-STEP CONTENT EXTRACTION ---
        let finalContent = "";
        const maxSourceScan = 4000; 
        const outputLimit = 1500;   

        for (let i = 0; i < Math.min(fullText.length, maxSourceScan); i += 200) {
            if (finalContent.length >= outputLimit) break;
            const chunk = fullText.substring(i, i + 100);
            if (chunk.length > 10) {
                finalContent += chunk + " ... ";
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
