// api/Citation_API.js
const fetch = require('node-fetch');

// --- ADDED: The list of models to try ---
const ALL_GEMINI_MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
];

// --- ADDED: Helper function to randomize the model list ---
const shuffleArray = (array) => {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
};

// --- ADDED: New resilient function to call the API ---
async function callGeminiApi(payload, apiKey) {
    if (!apiKey) throw new Error("API Key is not configured.");

    let modelsToTry = shuffleArray([...ALL_GEMINI_MODELS]);
    let lastError = null;

    for (const currentModel of modelsToTry) {
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;
        console.log(`Attempting API call with model: ${currentModel}`);
        
        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const errorMessage = errorData.error?.message || response.statusText;
                throw new Error(`API call with ${currentModel} failed (Status: ${response.status}): ${errorMessage}`);
            }

            const result = await response.json();
            const text = result.candidates?.[0]?.content?.parts?.[0]?.text;

            if (text && text.trim() !== '') {
                console.log(`Success with model: ${currentModel}`);
                return result; // Success!
            } else {
                throw new Error(`Model ${currentModel} returned an empty or invalid response.`);
            }
        } catch (error) {
            console.warn(error.message);
            lastError = error;
        }
    }
    throw lastError || new Error("All available models have been tried and failed.");
}


module.exports = async (req, res) => {
    // Standard CORS and method handling
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

        // --- STEP 1: Generate Search Query ---
        const summaryPrompt = `Summarize the following text into a single, concise search query of 10-15 words. Return ONLY the search query string. Text: "${essayText}"`;
        const summaryPayload = { contents: [{ role: 'user', parts: [{ text: summaryPrompt }] }] };
        
        // MODIFIED: Use the new resilient function
        const summaryData = await callGeminiApi(summaryPayload, geminiApiKey);
        const searchQuery = summaryData.candidates[0].content.parts[0].text.trim();
        if (!searchQuery) throw new Error("AI failed to generate a search query.");

        // --- STEP 2: Google Search ---
        const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${searchApiKey}&cx=${searchEngineId}&q=${encodeURIComponent(searchQuery)}`;
        const searchApiResponse = await fetch(searchUrl);
        const searchData = await searchApiResponse.json();
        const searchResults = searchData.items ? searchData.items.slice(0, 10).map(item => ({ title: item.title, snippet: item.snippet, url: item.link })) : [];

        if (searchResults.length === 0) {
            return res.status(200).json({ citations: ["No relevant sources were found."] });
        }

        // --- STEP 3: AI Generates Final Citations ---
        const finalPrompt = `
            You are an expert academic librarian. Your task is to generate a complete bibliography.
            RULES:
            1. Analyze the provided "Web Search Results" to find the author, title, and publication date for each source.
            2. If information is missing, use your knowledge to find it or make a reasonable estimation (e.g., use "n.d." for no date).
            3. Format ALL citations in the **${citationStyle.toUpperCase()}** style.
            4. Order the final list of citations **alphabetically** by author's last name.
            5. Return a maximum of ${citationCount === 'auto' ? 5 : citationCount} citations.
            6. Return ONLY a valid JSON array of strings. Each string is a single, fully formatted citation.
            Web Search Results:
            ${JSON.stringify(searchResults, null, 2)}
            Return ONLY a valid JSON array of formatted citation strings.
        `;
        
        const finalPayload = {
            contents: [{ role: 'user', parts: [{ text: finalPrompt }] }],
            generationConfig: { responseMimeType: "application/json" }
        };

        // MODIFIED: Use the new resilient function again
        const finalData = await callGeminiApi(finalPayload, geminiApiKey);
        const citations = JSON.parse(finalData.candidates[0].content.parts[0].text);

        res.status(200).json({ citations });

    } catch (error) {
        console.error('Error in serverless function:', error);
        res.status(500).json({ error: 'Failed to generate citation.', details: error.message });
    }
};
