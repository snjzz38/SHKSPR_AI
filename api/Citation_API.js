const { GoogleGenerativeAI } = require("@google/generative-ai");
const fetch = require('node-fetch');

// This is the Vercel serverless function entry point
exports.default = async function handler(request, response) {
    // Set a CORS header to allow requests from any origin (your frontend)
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') {
        return response.status(200).end();
    }

    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method Not Allowed' });
    }

    //
    // ⚠️ IMPORTANT: You MUST set this environment variable in your Vercel project settings.
    // Go to Project Settings -> Environment Variables, and add a variable named CITATION_1
    // with your Gemini API key as the value. The serverless function will not work without it.
    // Also, ensure your Vercel project's package.json includes "@google/generative-ai" and "node-fetch" as dependencies.
    //
    const apiKey = process.env.CITATION_1;

    if (!apiKey) {
        console.error("Missing CITATION_1 in environment variables.");
        return response.status(500).json({ error: 'Server configuration error: API key is missing. Please check your Vercel environment variables.' });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash-preview-05-20",
        tools: [{
            functionDeclarations: [
                {
                    name: "google_search",
                    description: "Search for information on Google.",
                    parameters: {
                        type: "OBJECT",
                        properties: {
                            queries: {
                                type: "ARRAY",
                                items: {
                                    type: "STRING"
                                }
                            }
                        }
                    }
                }
            ]
        }]
    });

    try {
        console.log('Received request body:', request.body);

        let prompt;
        // Robustly parse the request body
        if (typeof request.body === 'string') {
            try {
                const parsedBody = JSON.parse(request.body);
                prompt = parsedBody.prompt;
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

        // --- TOOL-HANDLING LOGIC ---
        const tool_handlers = {
            google_search: async (queries) => {
                const searchApiKey = process.env.SEARCH_1;
                const searchEngineId = "e5f6f17d0ff2a4ac3";

                if (!searchApiKey || !searchEngineId) {
                    throw new Error('Search API key or Search Engine ID is not configured.');
                }
                
                console.log('Performing Google Search for query:', queries[0]);

                try {
                    const url = `https://www.googleapis.com/customsearch/v1?key=${searchApiKey}&cx=${searchEngineId}&q=${encodeURIComponent(queries[0])}`;
                    const apiResponse = await fetch(url);
                    const data = await apiResponse.json();

                    if (!apiResponse.ok) {
                         console.error('Google Custom Search API error response:', data);
                         throw new Error(data.error?.message || 'Google Custom Search API error');
                    }

                    const results = data.items ? data.items.map(item => ({
                        source_title: item.title,
                        snippet: item.snippet,
                        url: item.link
                    })) : [];

                    return {
                        query: queries[0],
                        results: results
                    };
                } catch (error) {
                    console.error('Error in Google Custom Search API call:', error);
                    return {
                        query: queries[0],
                        error: `Failed to fetch search results: ${error.message}`
                    };
                }
            }
        };
        // --- END OF TOOL-HANDLING LOGIC ---

        // NEW LOGIC: Use generateContent for a single request
        // Explicitly construct the content object to ensure the correct format
        let result = await model.generateContent({ 
            contents: [{ 
                role: 'user', 
                parts: [{ text: prompt }] 
            }] 
        });

        // Check for function calls after the initial generation
        const functionCalls = result.response.functionCalls();
        if (functionCalls && functionCalls.length > 0) {
            const functionCall = functionCalls[0];
            console.log('Model requested a tool call:', functionCall);

            const toolResponse = await tool_handlers[functionCall.name](functionCall.args.queries);
            console.log('Tool response:', JSON.stringify(toolResponse, null, 2));

            // Generate content again, this time with the tool response
            result = await model.generateContent({
                contents: [
                    { role: 'user', parts: [{ text: prompt }] },
                    { role: 'tool', parts: [{ functionResponse: { name: functionCall.name, response: toolResponse } }] }
                ]
            });
        }
        
        const blockReason = result?.response?.promptFeedback?.blockReason;
        if (blockReason) {
            console.error('The model\'s response was blocked:', blockReason);
            return response.status(500).json({ error: `The AI model's response was blocked for safety reasons: ${blockReason}` });
        }

        const text = result?.response?.text();
        
        if (!text) {
            return response.status(500).json({ error: 'The AI model did not return any text, and no safety block was reported. Check the logs for the full response.' });
        }

        console.log('Final text response:', text);
        response.status(200).json({ citation: text });

    } catch (error) {
        console.error('Error generating citation:', error);
        response.status(500).json({ error: 'Failed to generate citation due to a server error.', details: error.message });
    }
};
