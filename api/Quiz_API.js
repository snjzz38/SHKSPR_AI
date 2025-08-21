// Located at: /api/Quiz_API.js

module.exports = async (req, res) => {
    // Set CORS headers to allow requests from your Vercel domain and localhost
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight OPTIONS request
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { model, contents } = req.body;
        const apiKey = process.env.QUIZ_1;

        if (!apiKey) {
            console.error('Server Error: QUIZ_1 environment variable not set.');
            return res.status(500).json({ error: 'Server configuration error.' });
        }
        
        if (!model || !contents) {
            return res.status(400).json({ error: 'Bad Request: Missing "model" or "contents" in request body.' });
        }

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const payload = {
            contents: contents,
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: "ARRAY",
                    items: {
                        type: "OBJECT",
                        properties: {
                            "question": { "type": "STRING" },
                            "answer": { "type": "STRING" },
                            "type": { "type": "STRING" },
                            "options": { "type": "ARRAY", "items": { "type": "STRING" } }
                        },
                    }
                }
            }
        };

        const apiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const responseData = await apiResponse.json();

        if (!apiResponse.ok) {
            console.error(`Google API Error (Model: ${model}):`, responseData);
            return res.status(apiResponse.status).json({
                error: 'AI Model Error',
                message: responseData.error?.message || 'An unknown error occurred with the AI model.'
            });
        }
        
        if (responseData.candidates && responseData.candidates[0]?.content?.parts?.[0]?.text) {
            // FIX: Use the correct variable name 'responseData'
            const jsonString = responseData.candidates[0].content.parts[0].text;
            // FIX: Use the correct variable name 'quizQuestions'
            const quizQuestions = JSON.parse(jsonString);
            
            res.status(200).json({ quizQuestions: quizQuestions });
        } else {
            throw new Error("Invalid or empty response structure from the AI model.");
        }

    } catch (error) {
        console.error('Error in serverless function:', error);
        res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
};
