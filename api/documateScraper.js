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

        // --- 1. META TAG EXTRACTION ---
        // Collect ALL authors from academic tags
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

        // Standard Meta Fallbacks
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

        // JSON-LD Fallback
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

        // --- 2. TEXT CLEANUP ---
        $('script, style, nav, footer, svg, noscript, iframe, header, aside, button, .ad, .advertisement').remove();
        const fullText = $('body').text().replace(/\s+/g, ' ').trim();

        // --- 3. AUTHOR FALLBACK (First 300 Chars) ---
        if (!author) {
            const introText = fullText.substring(0, 300);
            
            // Pattern 1: "By [Name]"
            const byMatch = introText.match(/By\s+([A-Z][a-z]+\s[A-Z][a-z]+)/);
            if (byMatch) {
                author = byMatch[1];
            } 
            // Pattern 2: ScienceDirect/Academic style (Names often appear before "Abstract" or "Show more")
            // We look for capitalized words separated by commas or "and" early in the text
            else {
                // This is a heuristic: Look for a sequence of names
                // e.g. "Adib Bin Rashid, MD Ashfakul Karim Kausik"
                const nameListMatch = introText.match(/([A-Z][a-z]+(?:\s[A-Z][a-z]+){1,3}(?:,\s[A-Z][a-z]+(?:\s[A-Z][a-z]+){1,3})*)/);
                if (nameListMatch && nameListMatch[0].length > 10 && !nameListMatch[0].includes("Skip")) {
                    author = nameListMatch[0];
                }
            }
        }

        // --- 4. DATE FALLBACK (Regex) ---
        if (!date) {
            const dateRegex = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}|(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}|\d{4}-\d{2}-\d{2}/i;
            const match = fullText.substring(0, 800).match(dateRegex);
            if (match) date = match[0];
        }

        // --- 5. SKIP-STEP CONTENT EXTRACTION ---
        // Scrape 100 chars, skip 100 chars, repeat.
        let finalContent = "";
        const maxSourceScan = 4000; // Scan up to 4000 chars of source text
        const outputLimit = 1500;   // But stop if we hit 1500 chars of output

        for (let i = 0; i < Math.min(fullText.length, maxSourceScan); i += 200) {
            if (finalContent.length >= outputLimit) break;

            // Take 100 characters
            const chunk = fullText.substring(i, i + 100);
            
            // Only add if it looks like real text (not just punctuation/numbers)
            if (chunk.length > 10) {
                finalContent += chunk + " ... ";
            }
            // The loop increments by 200, effectively skipping the next 100 characters
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
