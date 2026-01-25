import * as cheerio from 'cheerio';

// --- HELPER: SEARCH WEB (You need an API Key here, e.g., Serper.dev) ---
async function searchWeb(query, apiKey) {
    // RECOMMENDED: Use Serper.dev or similar for server-side searching
    // const res = await fetch('https://google.serper.dev/search', { ... })
    
    // FOR NOW: I will assume you have a search function or use a mock
    // If you have a custom search endpoint, call it here.
    console.log(`[Backend] Searching for: ${query}`);
    
    // Mock result for demonstration if no API key provided
    // REPLACE THIS WITH REAL SEARCH API CALL
    return [
        { title: "Example Source 1", link: "https://example.com/1" },
        { title: "Example Source 2", link: "https://example.com/2" }
    ];
}

// --- HELPER: SCRAPE URLS ---
async function scrapeUrls(urls) {
    const results = await Promise.all(urls.slice(0, 10).map(async (url) => {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s Timeout
            
            const res = await fetch(url, { 
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DocuMate/1.0)' },
                signal: controller.signal 
            });
            clearTimeout(timeoutId);
            
            if (!res.ok) throw new Error('Failed');
            const html = await res.text();
            const $ = cheerio.load(html);
            
            $('script, style, nav, footer, svg, header').remove();
            const title = $('title').text().trim() || "Untitled";
            const content = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 3000);
            
            return { id: 0, title, link: url, content };
        } catch (e) {
            return null;
        }
    }));
    return results.filter(r => r !== null).map((r, i) => ({ ...r, id: i + 1 }));
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { context, style, outputType, apiKey } = req.body;
        const GROQ_KEY = apiKey || process.env.GROQ_API_KEY;

        // 1. GENERATE QUERY (Groq)
        const queryRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "llama-3.1-8b-instant",
                messages: [{ role: "user", content: `Generate a google search query for: "${context.substring(0, 200)}". Return ONLY the query string.` }]
            })
        });
        const queryJson = await queryRes.json();
        const query = queryJson.choices[0].message.content.replace(/"/g, '').trim();

        // 2. SEARCH
        const searchResults = await searchWeb(query, GROQ_KEY); // Pass key if needed for search provider

        // 3. SCRAPE
        const sources = await scrapeUrls(searchResults.map(s => s.link));
        const sourceContext = JSON.stringify(sources);

        // 4. FORMAT (Groq)
        const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        
        let prompt = "";
        if (outputType === 'bibliography') {
            prompt = `Create a bibliography in ${style} style for these sources. Include "Accessed ${today}". Return plain text list. Sources: ${sourceContext}`;
        } else {
            prompt = `
                Insert citations into text: "${context}".
                Style: ${style}. Sources: ${sourceContext}.
                Rules: Cite EVERY sentence. Return JSON: { "insertions": [{ "anchor": "phrase", "source_id": 1, "citation_text": "..." }], "formatted_citations": { "1": "Full Citation (Accessed ${today})" } }
            `;
        }

        const formatRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "llama-3.1-8b-instant",
                messages: [{ role: "user", content: prompt }],
                response_format: outputType === 'bibliography' ? undefined : { type: "json_object" }
            })
        });
        
        const formatJson = await formatRes.json();
        const content = formatJson.choices[0].message.content;

        return res.status(200).json({
            success: true,
            sources: sources,
            result: outputType === 'bibliography' ? content : JSON.parse(content)
        });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
