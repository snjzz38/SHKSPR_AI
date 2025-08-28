// api/Citation_API.js
const fetch = require('node-fetch');

const ALL_GEMINI_MODELS = [
  'gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.0-flash',
  'gemini-2.0-flash-lite', 'gemini-1.5-flash', 'gemini-1.5-flash-8b',
];

const shuffleArray = (array) => {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
};

async function callGeminiApi(payload, apiKey) {
    let modelsToTry = shuffleArray([...ALL_GEMINI_MODELS]);
    let lastError = null;
    for (const currentModel of modelsToTry) {
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;
        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(`API call with ${currentModel} failed: ${errorData.error?.message || response.statusText}`);
            }
            const result = await response.json();
            const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text && text.trim() !== '') return result;
            throw new Error(`Model ${currentModel} returned an empty response.`);
        } catch (error) {
            console.warn(error.message);
            lastError = error;
        }
    }
    throw lastError || new Error("All API models failed.");
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
        const { essayText, citationCount } = req.body;
        if (!essayText) {
            return res.status(400).json({ error: 'Missing required field: essayText.' });
        }

        // Step 1: Generate Search Query
        const summaryPrompt = `
            You are a search query generator. Your sole task is to summarize the following text into a single, concise search query of 10-15 words. This query will be used in a search engine to find academic sources.
            RULES:
            - Return ONLY the search query string.
            - Do NOT include any introductory text, conversational phrases, or JSON formatting.
            Text to analyze:
            "${essayText}"
        `;
        const summaryPayload = { contents: [{ role: 'user', parts: [{ text: summaryPrompt }] }] };
        const summaryData = await callGeminiApi(summaryPayload, geminiApiKey);
        const searchQuery = summaryData.candidates[0].content.parts[0].text.trim();
        if (!searchQuery) throw new Error("Could not generate a search query from the provided text.");

        // Step 2: Google Search
        const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${searchApiKey}&cx=${searchEngineId}&q=${encodeURIComponent(searchQuery)}`;
        const searchApiResponse = await fetch(searchUrl);
        const searchData = await searchApiResponse.json();
        const allSearchResults = searchData.items ? searchData.items.slice(0, 10).map(item => ({ title: item.title, snippet: item.snippet, url: item.link })) : [];
        if (allSearchResults.length === 0) return res.status(200).json({ urls: [] });

        // Step 3: Filter Search Results
        const countInstruction = (citationCount === 'auto') ? `Return all relevant URLs.` : `Return a maximum of ${citationCount} of the most relevant URLs.`;
        const finalPrompt = `
            You are an expert research filter. Your task is to analyze the provided "Web Search Results" and select the ones most relevant to the "Original Topic Summary".
            PROCESS:
            1.  Read the "Original Topic Summary" to understand the core arguments.
            2.  Review the "Web Search Results".
            3.  Identify the most relevant and reputable sources from the list.
            4.  ${countInstruction}
            5.  Return ONLY a valid JSON array of URL strings for the relevant sources. For example: ["https://example.com/source1", "https://example.com/source2"]
            Original Topic Summary:
            "${searchQuery}" 
            Web Search Results:
            ${JSON.stringify(allSearchResults, null, 2)}
            Return ONLY a valid JSON array of URL strings.
        `;
        
        const finalPayload = {
            contents: [{ role: 'user', parts: [{ text: finalPrompt }] }],
            // --- THIS IS THE CRITICAL FIX ---
            generationConfig: { responseMimeType: "application/json" }
        };

        const finalData = await callGeminiApi(finalPayload, geminiApiKey);
        const responseText = finalData.candidates[0].content.parts[0].text;
        if (!responseText) throw new Error('The AI model did not return any text in the final step.');

        const urls = JSON.parse(responseText);
        res.status(200).json({ urls });

    } catch (error) {
        console.error('Error in serverless function:', error);
        res.status(500).json({ error: 'Failed to generate citation.', details: error.message });
    }
};
