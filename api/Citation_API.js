// This file does not require the @google/generative-ai library.
const fetch = require('node-fetch');

// This is the Vercel serverless function entry point
exports.default = async function handler(request, response) {
    // Set CORS headers
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') {
        return response.status(200).end();
    }

    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method Not Allowed' });
    }

    const geminiApiKey = process.env.CITATION_1;
    const searchApiKey = process.env.SEARCH_1;
    const searchEngineId = "e5f6f17d0ff2a4ac3";

    if (!geminiApiKey) {
        console.error("Missing CITATION_1 in environment variables.");
        return response.status(500).json({ error: 'Server configuration error: Gemini API key is missing.' });
    }
    if (!searchApiKey || !searchEngineId) {
        console.error("Missing SEARCH_1 or Search Engine ID in environment variables.");
        return response.status(500).json({ error: 'Server configuration error: Search API keys are missing.' });
    }

    try {
        console.log('Received request body:', request.body);

        let prompt;
        if (typeof request.body === 'string') {
            try {
                prompt = JSON.parse(request.body).prompt;
            } catch (e) {
                console.error('Failed to parse request body as JSON:', e);
                return response.status(400).json({ error: 'Invalid JSON in request body.' });
            }
        } else if (request.body && typeof request.body === 'object') {
            prompt = request.body.prompt;
        }

        if (!prompt) {
            console.error('Prompt is missing from the request body.');
            return response.status(400).json({ error: 'Prompt is required in the request body.' });
        }

        // Define the tool for Google Search
        const tools = [{
            functionDeclarations: [{
                name: "google_search",
                description: "Search for information on Google.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        queries: {
                            type: "ARRAY",
                            items: { type: "STRING" }
                        }
                    },
                    required: ["queries"]
                }
            }]
        }];
        
        // Step 1: Call the Gemini API with the prompt and tool definition
        const initialPayload = {
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            tools: tools,
            generationConfig: {
                // Ensure the model knows it can return a function call
                responseMimeType: "application/json"
            }
        };

        let geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${geminiApiKey}`;

        let geminiResponse = await fetch(geminiApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(initialPayload)
        });
        
        let geminiResult = await geminiResponse.json();

        // Check if the model returned a function call
        if (geminiResult && geminiResult.candidates && geminiResult.candidates[0] && geminiResult.candidates[0].content.parts[0].functionCall) {
            const functionCall = geminiResult.candidates[0].content.parts[0].functionCall;
            console.log('Model requested a tool call:', functionCall);

            if (functionCall.name === 'google_search') {
                const queries = functionCall.args.queries;
                if (!queries || queries.length === 0) {
                    console.error('No queries provided for Google Search.');
                    return response.status(500).json({ error: 'Google Search tool call failed: no queries provided.' });
                }
                const query = queries[0];
                
                console.log('Performing Google Search for query:', query);

                // Step 2: Call the Google Custom Search API
                const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${searchApiKey}&cx=${searchEngineId}&q=${encodeURIComponent(query)}`;
                const searchApiResponse = await fetch(searchUrl);
                const searchData = await searchApiResponse.json();

                if (!searchApiResponse.ok) {
                    console.error('Google Custom Search API error response:', searchData);
                    throw new Error(searchData.error?.message || 'Google Custom Search API error');
                }

                const searchResults = searchData.items ? searchData.items.map(item => ({
                    source_title: item.title,
                    snippet: item.snippet,
                    url: item.link
                })) : [];
                
                const toolResponse = {
                    query: query,
                    results: searchResults
                };
                
                // Step 3: Call the Gemini API again with the tool's response
                const finalPayload = {
                    contents: [
                        { role: 'user', parts: [{ text: prompt }] },
                        { role: 'tool', parts: [{ functionResponse: { name: functionCall.name, response: toolResponse } }] }
                    ],
                    tools: tools // Need to include tools again for multi-turn
                };
                
                let finalGeminiResponse = await fetch(geminiApiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(finalPayload)
                });
                
                geminiResult = await finalGeminiResponse.json();
            }
        }

        // Check for safety blocks
        const blockReason = geminiResult?.candidates?.[0]?.safetyRatings?.[0]?.blockReason;
        if (blockReason) {
            console.error('The model\'s response was blocked:', blockReason);
            return response.status(500).json({ error: `The AI model's response was blocked for safety reasons: ${blockReason}` });
        }

        // Extract the final text response
        const text = geminiResult?.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!text) {
            console.error('The AI model did not return any text.');
            console.log('Full Gemini response:', JSON.stringify(geminiResult, null, 2));
            return response.status(500).json({ error: 'The AI model did not return any text. Please check the server logs for the full response object.' });
        }

        console.log('Final text response:', text);
        response.status(200).json({ citation: text });

    } catch (error) {
        console.error('Error generating citation:', error);
        response.status(500).json({ error: 'Failed to generate citation due to a server error.', details: error.message });
    }
};
