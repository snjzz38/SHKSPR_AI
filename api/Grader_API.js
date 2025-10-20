// File: api/Grader_API.js
export default async function handler(request, response) {
    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        // --- ADD THIS DEBUGGING LINE ---
        console.log("Received request body:", JSON.stringify(request.body, null, 2));
        // -----------------------------

        const apiKey = request.body.apiKey || process.env.GRADER_1;

        if (!apiKey) {
            console.error("API key is not configured on the server (GRADER_1) and no custom key was provided.");
            throw new Error("API key is not configured.");
        }

        const { model, contents } = request.body;
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        
        const apiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: contents })
        });

        if (!apiResponse.ok) {
            const errorData = await apiResponse.json();
            const errorMessage = errorData.error?.message || `HTTP ${apiResponse.status} ${apiResponse.statusText}`;
            throw new Error(`Google Gemini API Error: ${errorMessage}`);
        }

        const result = await apiResponse.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!text) {
             throw new Error("Received an invalid or empty response structure from the Gemini API.");
        }

        response.status(200).json({ text });

    } catch (error) {
        console.error("Backend Error:", error);
        response.status(500).json({ error: error.message || 'An internal server error occurred.' });
    }
}
