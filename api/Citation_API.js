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
        const text = result.response.text();

        if (!text) {
            return response.status(500).json({ error: 'The AI model did not return any text.' });
        }

        response.status(200).json({ citation: text });

    } catch (error) {
        console.error('Error generating citation:', error);
        response.status(500).json({ error: 'Failed to generate citation due to a server error.', details: error.message });
    }
}
