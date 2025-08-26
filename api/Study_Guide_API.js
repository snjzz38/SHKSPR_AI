// api/Study_Guide_API.js

// Helper function to find and validate the structure from the AI's response
const findAndValidateStructure = (data) => {
    if (typeof data !== 'object' || data === null) return null;

    let studyGuide = null;
    let quizQuestions = null;

    // Find keys flexibly, ignoring case and looking for partial matches
    for (const key in data) {
        const lowerKey = key.toLowerCase();
        if (lowerKey.includes('study') && lowerKey.includes('guide')) {
            if (typeof data[key] === 'string') {
                studyGuide = data[key];
            }
        }
        if (lowerKey.includes('quiz') && lowerKey.includes('question')) {
            if (Array.isArray(data[key]) && data[key].length > 0) {
                quizQuestions = data[key];
            }
        }
    }

    // The guide can be an empty string, but the questions must exist
    if (studyGuide !== null && quizQuestions !== null) {
        return { studyGuide, quizQuestions };
    }
    return null;
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'API key is not configured.' });
    }

    const { model, contents } = req.body;

    if (!model || !contents) {
        return res.status(400).json({ error: 'Missing model or contents in the request body.' });
    }

    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const payload = {
        contents,
        generationConfig: {
            response_mime_type: "application/json",
        },
    };

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorBody = await response.json();
            console.error('Google API Error:', errorBody);
            return res.status(response.status).json({ error: `Google API Error: ${errorBody.error.message}` });
        }

        const data = await response.json();
        
        // Extract and clean the response text
        let responseText = data.candidates[0].content.parts[0].text;
        if (responseText.startsWith("```json")) {
            responseText = responseText.substring(7, responseText.length - 3).trim();
        } else if (responseText.startsWith("```")) {
            responseText = responseText.substring(3, responseText.length - 3).trim();
        }

        const parsedResult = JSON.parse(responseText);
        const validatedData = findAndValidateStructure(parsedResult);

        if (validatedData) {
            return res.status(200).json(validatedData);
        } else {
            return res.status(500).json({ error: 'AI returned valid JSON but with an unexpected structure.' });
        }

    } catch (error) {
        console.error('Server-side Error:', error);
        return res.status(500).json({ error: `An internal server error occurred: ${error.message}` });
    }
}
