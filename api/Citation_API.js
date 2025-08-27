// api/Citation_API.js
const fetch = require('node-fetch');

module.exports = async (req, res) => {
    // Standard CORS and method handling
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // Securely get API keys from environment variables
    const geminiApiKey = process.env.CITATION_1;
    const searchApiKey = process.env.SEARCH_1;
    const searchEngineId = "e5f6f17d0ff2a4ac3";

    if (!geminiApiKey || !searchApiKey) {
        return res.status(500).json({ error: 'Server configuration error: API keys are missing.' });
    }

    try {
        // The frontend now sends the model and the full 'contents' payload
        const { model, contents } = req.body;
        if (!model || !contents) {
            return res.status(400).json({ error: 'Missing "model" or "contents" in the request body.' });
        }

        const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;

        // This is the initial payload, built by the client
        const initialPayload = {
            contents: contents,
            tools: [{
                functionDeclarations: [{
                    name: "google_search",
                    description: "Search Google for reputable sources to verify claims.",
                    parameters: {
                        type: "OBJECT",
                        properties: { "queries": { "type": "ARRAY", "items": { "type": "STRING" } } },
                        required: ["queries"]
                    }
                }]
            }],
            generationConfig: { responseMimeType: "application/json" }
        };

        // Step 1: First call to Gemini to see if it needs to use a tool
        let geminiResponse = await fetch(geminiApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(initialPayload)
        });
        
        let geminiResult = await geminiResponse.json();

        // Step 2: If the model requests a tool call, execute it
        if (geminiResult?.candidates?.[0]?.content?.parts?.[0]?.functionCall) {
            const functionCall = geminiResult.candidates[0].content.parts[0].functionCall;

            if (functionCall.name === 'google_search') {
                const queries = functionCall.args.queries;
                if (!queries || queries.length === 0) throw new Error('Search tool call failed: no queries provided.');
                
                // Perform all searches in parallel for speed
                const searchPromises = queries.map(query => {
                    const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${searchApiKey}&cx=${searchEngineId}&q=${encodeURIComponent(query)}`;
                    return fetch(searchUrl).then(res => res.json());
                });

                const searchApiResponses = await Promise.all(searchPromises);
                
                const allSearchResults = searchApiResponses.flatMap(searchData => 
                    searchData.items ? searchData.items.slice(0, 3).map(item => ({
                        title: item.title,
                        snippet: item.snippet,
                        url: item.link
                    })) : []
                );

                // Step 3: Send the search results back to the model
                const finalPayload = {
                    contents: [
                        ...initialPayload.contents,
                        { role: 'model', parts: [{ functionCall }] },
                        { role: 'tool', parts: [{ functionResponse: { name: 'google_search', response: { results: allSearchResults } } }] }
                    ],
                };
                
                let finalGeminiResponse = await fetch(geminiApiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(finalPayload)
                });
                
                geminiResult = await finalGeminiResponse.json();
            }
        }

        // Step 4: Extract and return the final text content
        let responseText = geminiResult?.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!responseText) {
            console.error('Full Gemini response:', JSON.stringify(geminiResult, null, 2));
            throw new Error('The AI model did not return any text.');
        }

        // The frontend expects a JSON object with a 'citations' key
        res.status(200).json({ citations: JSON.parse(responseText) });

    } catch (error) {
        console.error('Error in serverless function:', error);
        res.status(500).json({ error: 'Failed to generate citation.', details: error.message });
    }
};
