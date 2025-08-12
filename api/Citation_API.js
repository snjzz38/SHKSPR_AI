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

        const result = await model.generateContent(prompt);
        
        const functionCall = result.response.functionCall();
        
        if (functionCall) {
            // --- START OF FIXED TOOL-HANDLING LOGIC ---
            console.log('Model requested a tool call:', functionCall);

            const tool_handlers = {
                google_search: async (queries) => {
                    console.log('Simulating Google Search for queries:', queries);
                    return {
                        query: queries[0],
                        results: [
                            {
                                source_title: "Wikipedia",
                                snippet: "The history of the internet began with the development of electronic computers in the 1950s...",
                                url: "https://en.wikipedia.org/wiki/History_of_the_Internet"
                            },
                            {
                                source_title: "Computer History Museum",
                                snippet: "The Internet is the global system of interconnected computer networks that uses the Internet protocol suite (TCP/IP) to link billions of devices...",
                                url: "https://www.computerhistory.org/internethistory/"
                            }
                        ]
                    };
                }
            };
            
            const toolResponse = await tool_handlers[functionCall.name](functionCall.args.queries);

            // Construct the conversation history to send back to the model.
            const chatHistory = [
                { role: "user", parts: [{ text: prompt }] },
                { role: "model", parts: [{ functionCall: functionCall }] },
                { role: "tool", parts: [{ functionResponse: { name: functionCall.name, response: toolResponse } }] }
            ];

            // Send the full conversation history to the model to get the final text response.
            const secondResult = await model.generateContent({ contents: chatHistory });

            const text = secondResult.response.text();
            
            if (!text) {
                return response.status(500).json({ error: 'The AI model did not return any text after the tool call.' });
            }

            response.status(200).json({ citation: text });
            // --- END OF FIXED TOOL-HANDLING LOGIC ---

        } else {
            // If no tool call, proceed as before.
            const text = result.response.text();
            
            if (!text) {
                return response.status(500).json({ error: 'The AI model did not return any text.' });
            }

            response.status(200).json({ citation: text });
        }

    } catch (error) {
        console.error('Error generating citation:', error);
        response.status(500).json({ error: 'Failed to generate citation due to a server error.', details: error.message });
    }
}
