// api/Citation_API.js
const fetch = require('node-fetch');

// Helper function to fetch content from a URL
async function fetchUrlContent(url) {
    try {
        const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!response.ok) return `Could not fetch content (status: ${response.status}).`;
        // We only need a snippet for context, not the whole page
        const text = await response.text();
        // A simple way to get the most relevant text part, avoiding huge HTML dumps
        const bodyMatch = text.match(/<body[^>]*>([\s\S]*)<\/body>/i);
        const cleanText = (bodyMatch ? bodyMatch[1] : text)
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s\s+/g, ' ')
            .trim();
        return cleanText.substring(0, 1500); // Limit to first 1500 chars for efficiency
    } catch (error) {
        console.warn(`Failed to fetch ${url}: ${error.message}`);
        return `Content fetch failed for this URL.`;
    }
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const geminiApiKey = process.env.CITATION_1;
    const searchApiKey = process.env.SEARCH_1;
    const searchEngineId = "e5f6f17d0ff2a4ac3";

    if (!geminiApiKey || !searchApiKey) {
        return res.status(500).json({ error: 'Server configuration error: API keys are missing.' });
    }

    try {
        const { essayText, citationStyle, outputType, citationCount } = req.body;
        if (!essayText) {
            return res.status(400).json({ error: 'Missing required field: essayText.' });
        }

        const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${geminiApiKey}`;

        // --- STEP 1: Generate Search Query (Unchanged) ---
        const summaryPrompt = `Summarize the following text into a single, concise search query of 10-15 words. Return ONLY the search query string. Text: "${essayText}"`;
        const summaryPayload = { contents: [{ role: 'user', parts: [{ text: summaryPrompt }] }] };
        const summaryResponse = await fetch(geminiApiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(summaryPayload) });
        if (!summaryResponse.ok) throw new Error('Failed to generate search query.');
        const summaryData = await summaryResponse.json();
        const searchQuery = summaryData.candidates[0].content.parts[0].text.trim();

        // --- STEP 2: Google Search (Unchanged) ---
        const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${searchApiKey}&cx=${searchEngineId}&q=${encodeURIComponent(searchQuery)}`;
        const searchApiResponse = await fetch(searchUrl);
        const searchData = await searchApiResponse.json();
        const searchResults = searchData.items ? searchData.items.slice(0, 10).map(item => ({ title: item.title, snippet: item.snippet, url: item.link })) : [];

        // --- STEP 3: Filter URLs (Unchanged) ---
        const filterPrompt = `You are a research filter. Analyze the "Web Search Results" and select the ones most relevant to the "Original Topic Summary". Return a maximum of ${citationCount === 'auto' ? 5 : citationCount} URLs. Return ONLY a valid JSON array of URL strings. Original Topic Summary: "${searchQuery}". Web Search Results: ${JSON.stringify(searchResults)}`;
        const filterPayload = { contents: [{ role: 'user', parts: [{ text: filterPrompt }] }], generationConfig: { responseMimeType: "application/json" } };
        const filterResponse = await fetch(geminiApiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(filterPayload) });
        if (!filterResponse.ok) throw new Error('AI failed to filter search results.');
        const filterData = await filterResponse.json();
        const filteredUrls = JSON.parse(filterData.candidates[0].content.parts[0].text);

        if (!filteredUrls || filteredUrls.length === 0) {
            return res.status(200).json({ citations: ["No relevant sources were found."] });
        }

        // --- STEP 4: Fetch Content from Filtered URLs (New) ---
        const fetchedContents = await Promise.all(
            filteredUrls.map(async (url) => ({
                url: url,
                content: await fetchUrlContent(url)
            }))
        );

        // --- STEP 5: Generate Final Citations (New) ---
        const citationPrompt = `
            You are an expert academic librarian. Your task is to generate a complete bibliography.

            RULES:
            1.  Analyze the "Fetched Content from URLs" to find the author, title, and publication date for each source.
            2.  If information is missing, use your knowledge to find it or make a reasonable estimation (e.g., use "n.d." for no date).
            3.  Format ALL citations in the **${citationStyle.toUpperCase()}** style.
            4.  Order the final list of citations **alphabetically** by author's last name.
            5.  Return ONLY a valid JSON array of strings. Each string is a single, fully formatted citation.

            Original Essay Context (for topic reference only):
            "${essayText}"

            Fetched Content from URLs:
            ${JSON.stringify(fetchedContents, null, 2)}

            Return ONLY a valid JSON array of formatted citation strings.
        `;
        
        const citationPayload = {
            contents: [{ role: 'user', parts: [{ text: citationPrompt }] }],
            generationConfig: { responseMimeType: "application/json" }
        };

        const citationResponse = await fetch(geminiApiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(citationPayload) });
        if (!citationResponse.ok) throw new Error('AI failed to generate final citations.');
        const citationData = await citationResponse.json();
        const citations = JSON.parse(citationData.candidates[0].content.parts[0].text);

        res.status(200).json({ citations });

    } catch (error) {
        console.error('Error in serverless function:', error);
        res.status(500).json({ error: 'Failed to generate citation.', details: error.message });
    }
};
