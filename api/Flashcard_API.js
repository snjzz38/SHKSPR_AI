// Located at: /api/Flashcard_API.js

module.exports = async (req, res) => {
    // Set CORS headers to allow requests from your Vercel domain and localhost
    res.setHeader('Access-Control-Allow-Origin', '*'); // For development; consider restricting to your domain in production
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle the browser's preflight OPTIONS request
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        // The client now sends the specific model to use and the pre-built 'contents' payload
        const { model, contents } = req.body;

        // Securely retrieve the secret API key from your Vercel environment variables
        const apiKey = process.env.FLASHCARD_1;

        if (!apiKey) {
            console.error('Server Error: FLASHCARD_1 environment variable not set.');
            return res.status(500).json({ error: 'Server configuration error.' });
        }
        
        if (!model || !contents) {
            return res.status(400).json({ error: 'Bad Request: Missing "model" or "contents" in the request body.' });
        }

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        // This is the final payload sent to the Google API.
        // The client builds the 'contents', and the server adds the required 'generationConfig'.
        const payload = {
            contents: contents,
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: "ARRAY",
                    items: {
                        type: "OBJECT",
                        properties: {
                            "front": { "type": "STRING" },
                            "back": { "type": "STRING" }
                        },
                    }
                }
            }
        };

        // Make the call to the external Google API
        const apiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const responseData = await apiResponse.json();

        // If the Google API returns an error, forward it to the client for debugging
        if (!apiResponse.ok) {
            console.error(`Google API Error (Model: ${model}):`, responseData);
            return res.status(apiResponse.status).json({
                error: 'AI Model Error',
                message: responseData.error?.message || 'An unknown error occurred with the AI model.'
            });
        }
        
        // The Google API returns a candidate with a 'text' field containing a stringified JSON array.
        // We need to parse this string to get the actual flashcard data.
        if (responseData.candidates && responseData.candidates[0]?.content?.parts?.[0]?.text) {
            const jsonString = responseData.candidates[0].content.parts[0].text;
            const flashcards = JSON.parse(jsonString);
            
            // Send the successful, parsed flashcard array back to the client
            res.status(200).json({ flashcards: flashcards });
        } else {
            // This handles cases where the API gives a 200 OK but the response is empty or malformed
            throw new Error("Invalid or empty response structure from the AI model.");
        }

    } catch (error) {
        console.error('Error in serverless function:', error);
        res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
};
