// File: api/Grader_API.js
// Import the fetch function if you are using a Node.js version < 18
// For Vercel's Node.js 18+ runtime, fetch is available globally.
// const fetch = require('node-fetch');

// The Gemini model to use for grading.
const GEMINI_MODEL = "gemini-1.5-flash"; // Using a stable model

export default async function handler(request, response) {
    // Ensure the request is a POST request.
    if (request.method !== 'POST') {
        response.status(405).json({ error: 'Method Not Allowed' });
        return;
    }

    try {
        // Retrieve the Google API key from Vercel environment variables.
        // Make sure GRADER_1 is set in your Vercel project settings.
        const googleApiKey = process.env.GRADER_1;
        if (!googleApiKey) {
            console.error("Environment variable GRADER_1 is not set.");
            throw new Error("API key (GRADER_1) is not configured on the server.");
        }

        // Get the data from the frontend request body.
        const { instructionsData, rubricData, essayData, extraInstructions, strictness } = request.body;

        // --- Construct the prompt for the Gemini API ---
        const systemPrompt = `You are an expert AI assignment grader. Your task is to evaluate a student's assignment based on the provided instructions and a specific grading rubric.

Grading Strictness Level: ${strictness} (1=Very Lenient, 3=Normal, 5=Very Strict).
- Level 1-2 (Lenient): Focus on major concepts and effort. Be forgiving of minor errors.
- Level 3 (Normal): Provide a balanced assessment of strengths and weaknesses.
- Level 4-5 (Strict): Be highly critical. Identify all errors, even minor ones, and apply point deductions rigorously.

${extraInstructions ? `CRITICAL INSTRUCTION: Prioritize this above all else: "${extraInstructions}"` : ''}

Output your response in structured Markdown with these exact headings and ample spacing. Give SPECIFIC examples inside the user input to back up what you are saying:
# Overall Grade
## Detailed Feedback
## General Comments
## What to Work On to Improve`;

        const parts = [{ text: systemPrompt }];

        // Helper function to add a section (text and images) to the prompt parts.
        const addSection = (label, data) => {
            if (!data) return;
            parts.push({ text: `\n\n--- ${label} ---\n${data.combinedText}` });
            if (data.imageParts && data.imageParts.length > 0) {
                data.imageParts.forEach(img => {
                    parts.push({ text: `\n(Image reference: ${img.filename})` });
                    parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
                });
            }
        };

        // Add all the sections from the frontend to the prompt.
        addSection("ASSIGNMENT INSTRUCTIONS", instructionsData);
        addSection("GRADING RUBRIC", rubricData);
        addSection("STUDENT'S ASSIGNMENT TO GRADE", essayData);

        // Prepare the final payload for the Gemini API.
        const payload = { contents: [{ role: "user", parts }] };

        // --- FIX: Corrected URL construction by removing potential formatting issues ---
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${googleApiKey}`;

        // --- Make the call to the Google Gemini API ---
        const apiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!apiResponse.ok) {
            const errorData = await apiResponse.json();
            console.error("Gemini API Error Response:", errorData);
            // Provide more context in the error message sent to the client
            const errorMessage = errorData.error?.message || `HTTP ${apiResponse.status} ${apiResponse.statusText}`;
            throw new Error(`Google Gemini API Error: ${errorMessage}`);
        }

        const result = await apiResponse.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;

        if (text === undefined || text === null) {
             console.error("Gemini API returned unexpected structure:", JSON.stringify(result, null, 2));
             throw new Error("Received an invalid or empty response structure from the Gemini API.");
        }

        // Send the successful response back to the frontend.
        response.status(200).json({ text: text });

    } catch (error) {
        // Log the full error on the server for debugging.
        console.error("Backend Error in Grader_API.js:", error);
        // Send a generic error message to the client.
        const clientErrorMessage = error.message || 'An internal server error occurred during grading.';
        response.status(500).json({ error: clientErrorMessage });
    }
}
