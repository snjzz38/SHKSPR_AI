// api/Citation_API.js
const fetch = require('node-fetch');

module.exports = async (req, res) => {
    // Standard CORS and method handling
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    // Securely get API keys from environment variables
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
        if (!summaryResponse.ok) throw new Error('AI failed to generate a search query.');
        const summaryData = await summaryResponse.json();
        const searchQuery = summaryData.candidates[0].content.parts[0].text.trim();

        // --- STEP 2: Google Search (Unchanged) ---
        const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${searchApiKey}&cx=${searchEngineId}&q=${encodeURIComponent(searchQuery)}`;
        const searchApiResponse = await fetch(searchUrl);
        const searchData = await searchApiResponse.json();
        const searchResults = searchData.items ? searchData.items.slice(0, 10).map(item => ({ title: item.title, snippet: item.snippet, url: item.link })) : [];

        if (searchResults.length === 0) {
            return res.status(200).json({ citations: ["No relevant sources were found."] });
        }

        // --- STEP 3: AI Generates Final Citations (REWRITTEN) ---
        // This prompt is now much more efficient. It uses the clean title and snippet instead of fetching the whole page.
        const finalPrompt = `
            You are an expert academic librarian. Your task is to generate a complete bibliography.

            RULES:
            1.  Analyze the provided "Web Search Results" to find the author, title, and publication date for each source.
            2.  If information is missing from the title or snippet, use your knowledge to find it or make a reasonable estimation (e.g., use "n.d." for no date, use the website name as the author if none is listed).
            3.  Format ALL citations in the **${citationStyle.toUpperCase()}** style.
            4.  Order the final list of citations **alphabetically** by author's last name.
            5.  Return a maximum of ${citationCount === 'auto' ? 5 : citationCount} citations.
            6.  Return ONLY a valid JSON array of strings. Each string is a single, fully formatted citation.

            Web Search Results:
            ${JSON.stringify(searchResults, null, 2)}

            Return ONLY a valid JSON array of formatted citation strings.
        `;
        
        const finalPayload = {
            contents: [{ role: 'user', parts: [{ text: finalPrompt }] }],
            generationConfig: { responseMimeType: "application/json" }
        };

        const finalResponse = await fetch(geminiApiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(finalPayload) });
        
        if (!finalResponse.ok) {
            // This is the error you were seeing.
            throw new Error('AI failed to generate final citations.');
        }

        const finalData = await finalResponse.json();
        const citations = JSON.parse(finalData.candidates[0].content.parts[0].text);

        res.status(200).json({ citations });

    } catch (error) {
        console.error('Error in serverless function:', error);
        res.status(500).json({ error: 'Failed to generate citation.', details: error.message });
    }
};
