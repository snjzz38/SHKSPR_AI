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

        const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${geminiApiKey}`;

        // --- FIX: Made the initial prompt extremely strict to ensure a clean output ---
        const summaryPrompt = `
            You are a search query generator. Your sole task is to summarize the following text into a single, concise search query of 10-15 words. This query will be used in a search engine to find academic sources.

            RULES:
            - Return ONLY the search query string.
            - Do NOT include any introductory text, conversational phrases, or JSON formatting.
            - Focus on the main thesis or subject of the text.

            EXAMPLE:
            Text: "The Industrial Revolution led to significant urbanization and social changes in 19th-century Europe."
            Your Output:
            Industrial Revolution urbanization social changes 19th-century Europe

            Text to analyze:
            "${essayText}"
        `;
        
        const summaryPayload = {
            contents: [{ role: 'user', parts: [{ text: summaryPrompt }] }]
        };

        const summaryResponse = await fetch(geminiApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(summaryPayload)
        });
        if (!summaryResponse.ok) throw new Error('Failed to generate a search query from the text.');
        
        const summaryData = await summaryResponse.json();
        const searchQuery = summaryData.candidates[0].content.parts[0].text.trim();

        if (!searchQuery) {
            throw new Error("Could not generate a search query from the provided text.");
        }

        // --- STEP 2: Proactively perform a web search using the AI-generated summary ---
        const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${searchApiKey}&cx=${searchEngineId}&q=${encodeURIComponent(searchQuery)}`;
        const searchApiResponse = await fetch(searchUrl);
        const searchData = await searchApiResponse.json();

        const uniqueUrls = new Set();
        const allSearchResults = searchData.items ? searchData.items.slice(0, 10).map(item => ({
            title: item.title,
            snippet: item.snippet,
            url: item.link
        })).filter(item => {
            if (!item.url || uniqueUrls.has(item.url)) return false;
            uniqueUrls.add(item.url);
            return true;
        }) : [];

        if (allSearchResults.length === 0) {
            return res.status(200).json({ urls: [] });
        }

        // --- STEP 3: Second AI call to filter the search results and return only URLs ---
        const countInstruction = (citationCount === 'auto')
            ? `Return all relevant URLs.`
            : `Return a maximum of ${citationCount} of the most relevant URLs.`;

        const finalPrompt = `
            You are an expert research filter. Your task is to analyze the provided "Web Search Results" and select the ones most relevant to the original "Essay Text".

            PROCESS:
            1.  Read the "Essay Text" to understand its core arguments.
            2.  Review the "Web Search Results".
            3.  Identify the most relevant and reputable sources from the list.
            4.  ${countInstruction}
            5.  Return ONLY a valid JSON array of URL strings for the relevant sources. For example: ["https://example.com/source1", "https://example.com/source2"]

            Essay Text:
            "${essayText}" 

            Web Search Results:
            ${JSON.stringify(allSearchResults, null, 2)}

            Return ONLY a valid JSON array of URL strings.
        `;

        const finalPayload = {
            contents: [{ role: 'user', parts: [{ text: finalPrompt }] }],
            generationConfig: { responseMimeType: "application/json" }
        };

        const finalResponse = await fetch(geminiApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(finalPayload)
        });

        if (!finalResponse.ok) throw new Error('The AI failed to filter the search results.');

        const finalData = await finalResponse.json();
        let responseText = finalData.candidates[0].content.parts[0].text;
        
        if (!responseText) {
            console.error('Full Gemini response:', JSON.stringify(finalData, null, 2));
            throw new Error('The AI model did not return any text in the final step.');
        }

        const urls = JSON.parse(responseText);
        res.status(200).json({ urls });

    } catch (error) {
        console.error('Error in serverless function:', error);
        res.status(500).json({ error: 'Failed to generate citation.', details: error.message });
    }
};
