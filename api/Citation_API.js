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
    //
    const apiKey = process.env.CITATION_1;

    if (!apiKey) {
        console.error("Missing CITATION_1 in environment variables.");
        // We'll return a JSON error here, but Vercel may still send a generic page if the build fails.
        return response.status(500).json({ error: 'Server configuration error: API key is missing.' });
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
        const { essayText, citationStyle, outputType } = request.body;

        if (!essayText) {
            return response.status(400).json({ error: 'Essay text is required in the request body.' });
        }

        // The prompt is designed to instruct the model to use the search tool and format the output correctly.
        const prompt = `
            You are a helpful AI that generates academic citations based on provided text.
            
            Task:
            1. Analyze the following essay text to identify claims or facts that require an external source.
            2. Use the 'google_search' tool to find a reputable source (e.g., academic journal, official report, book, or major news site) that supports each claim.
            3. Based on the information found, generate a citation for each source in the requested style.
            4. If the output type is 'bibliography', list the full citations. If the output type is 'in-text', generate only the in-text citations.
            5. If no sources are found or the text doesn't contain citable information, respond with "No citations found."

            Essay Text:
            "${essayText}"

            Citation Style: ${citationStyle}
            Output Type: ${outputType}

            Ensure each citation is properly formatted according to the specified style.
        `;

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
