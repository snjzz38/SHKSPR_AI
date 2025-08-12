import { GoogleGenerativeAI } from "@google/generative-ai";

// This is the Vercel serverless function entry point
export default async function handler(request, response) {
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
    // Also, ensure your Vercel project's package.json includes "@google/generative-ai" as a dependency.
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
        // We now get the prompt directly from the request body.
        const { prompt } = request.body;

        if (!prompt) {
            return response.status(400).json({ error: 'Prompt is required in the request body.' });
        }

        // --- START OF FIXED MULTI-TURN TOOL-HANDLING LOGIC ---
        const tool_handlers = {
            google_search: async (queries) => {
                const searchApiKey = process.env.SEARCH_1; // Use the user-provided environment variable
                const searchEngineId = "e5f6f17d0ff2a4ac3"; // ⚠️ This has been replaced with your actual Search Engine ID

                if (!searchApiKey || searchEngineId === "e5f6f17d0ff2a4ac3") {
                    throw new Error('Search API key or Search Engine ID is not configured.');
                }

                const searchQuery = queries[0];
                const url = `https://www.googleapis.com/customsearch/v1?key=${searchApiKey}&cx=${searchEngineId}&q=${encodeURIComponent(searchQuery)}`;
                
                console.log('Performing Google Search for query:', searchQuery);

                try {
                    const apiResponse = await fetch(url);
                    const data = await apiResponse.json();

                    if (!apiResponse.ok) {
                         throw new Error(data.error?.message || 'Google Custom Search API error');
                    }

                    // Format the real search results for the model
                    const results = data.items.map(item => ({
                        source_title: item.title,
                        snippet: item.snippet,
                        url: item.link
                    }));

                    return {
                        query: searchQuery,
                        results: results
                    };
                } catch (error) {
                    console.error('Error in Google Custom Search API call:', error);
                    return {
                        query: searchQuery,
                        error: `Failed to fetch search results: ${error.message}`
                    };
                }
            }
        };

        // Use model.startChat() for multi-turn conversations
        const chat = model.startChat();
        let result = await chat.sendMessage(prompt);
        
        // Add a safety limit to prevent infinite loops
        const maxTurns = 5;
        for (let i = 0; i < maxTurns; i++) {
            const functionCalls = result.response.functionCalls();
            
            if (functionCalls && functionCalls.length > 0) {
                console.log('Model requested a tool call:', functionCalls[0]);

                const functionCall = functionCalls[0];
                const toolResponse = await tool_handlers[functionCall.name](functionCall.args.queries);

                console.log('Tool response:', JSON.stringify(toolResponse, null, 2));

                result = await chat.sendMessage({
                    role: 'tool',
                    parts: [{ functionResponse: { name: functionCall.name, response: toolResponse } }]
                });

            } else {
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
                return; // Exit the loop
            }
        }
        
        // If the loop finishes without a text response, it means the model is stuck
        return response.status(500).json({ error: `The model is stuck in a tool-calling loop after ${maxTurns} turns. Try again with a different prompt.` });
        // --- END OF FIXED MULTI-TURN TOOL-HANDLING LOGIC ---

    } catch (error) {
        console.error('Error generating citation:', error);
        response.status(500).json({ error: 'Failed to generate citation due to a server error.', details: error.message });
    }
}
