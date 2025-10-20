// File: api/Grader_API.js
export default async function handler(request, response) {
    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        // --- START OF FIX ---

        // 1. Prioritize the custom API key sent from the browser's request body.
        // 2. If no custom key is provided, fall back to the server's default key.
        const apiKey = request.body.apiKey || process.env.GRADER_1;

        // 3. Add a safety check. If NEITHER key is available, stop and throw an error.
        if (!apiKey) {
            console.error("API key is not configured on the server (GRADER_1) and no custom key was provided.");
            throw new Error("API key is not configured.");
        }

        const { model, contents } = request.body;
        
        // 4. Use the selected 'apiKey' in the URL.
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        
        // --- END OF FIX ---
        
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
