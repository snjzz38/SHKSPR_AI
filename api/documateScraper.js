import * as cheerio from 'cheerio';

export default async function handler(req, res) {
  // 1. CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { urls, apiKey } = req.body; // Now accepts apiKey
    if (!urls || !Array.isArray(urls)) return res.status(400).json({ error: "No URLs provided" });

    // Use Server Key if client didn't provide one (Ensure this ENV is set in Vercel)
    const GROQ_KEY = apiKey || process.env.GROQ_API_KEY; 

    // 2. Process URLs (Max 10)
    const results = await Promise.all(urls.slice(0, 10).map(async (url) => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s Timeout

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

        // B. Clean Text for LLM
        $('script, style, nav, footer, svg, noscript, iframe, aside, .ad, .advertisement, header, .menu').remove();
        const title = $('title').text().trim().substring(0, 100);
        const bodyText = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 2500); // Limit context

        // C. Groq Metadata Extraction
        let meta = { author: "Unknown", date: "n.d.", site: "" };
        
        if (GROQ_KEY) {
            try {
                const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${GROQ_KEY}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        model: "llama-3.1-8b-instant",
                        messages: [{
                            role: "system",
                            content: `Extract metadata from the text. Return JSON ONLY.
                            Rules:
                            1. Author: "First Last" or "Organization". No "By".
                            2. Date: YYYY-MM-DD format if possible, else YYYY.
                            3. Site: The publication/website name.
                            
                            JSON Format: { "author": "string", "date": "string", "site": "string" }`
                        }, {
                            role: "user",
                            content: `Title: ${title}\nText: ${bodyText}`
                        }],
                        temperature: 0.1,
                        response_format: { type: "json_object" }
                    })
                });

                if (groqRes.ok) {
                    const groqJson = await groqRes.json();
                    const extracted = JSON.parse(groqJson.choices[0].message.content);
                    meta = {
                        author: extracted.author || "Unknown",
                        date: extracted.date || "n.d.",
                        site: extracted.site || new URL(url).hostname.replace('www.', '')
                    };
                }
            } catch (e) {
                console.error("Groq Extraction Failed:", e);
                // Fallback to basic domain parsing if LLM fails
                meta.site = new URL(url).hostname;
            }
        }

        return { 
            url, 
            status: "ok", 
            title: title, 
            meta: meta, 
            content: bodyText.substring(0, 1000) 
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
