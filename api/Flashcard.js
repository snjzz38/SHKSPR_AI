// api/Flashcard.js

// Define available Gemini models
const ALL_GEMINI_MODELS = [
    'gemini-2.5-flash-lite',
    'gemini-live-2.5-flash-preview',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-2.0-flash-live-001',
    'gemini-1.5-flash',
    'gemini-1.5-flash-8b',
];

// Helper function to shuffle an array
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

module.exports = async (req, res) => {
    // Set CORS headers for local development and Vercel deployment
    res.setHeader('Access-Control-Allow-Origin', '*'); // Adjust this for production to your specific domain
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed', message: 'Only POST requests are allowed.' });
    }

    try {
        const { inputText, customInstructions, uploadedFiles } = req.body;

        // Retrieve API key from environment variables
        // *** MODIFIED: Changed from process.env.GEMINI_API_KEY to process.env.FLASHCARD_1 ***
        const apiKey = process.env.FLASHCARD_1;

        if (!apiKey) {
            console.error('Server Configuration Error: FLASHCARD_1 environment variable not configured.');
            return res.status(500).json({ error: 'Server Configuration Error', message: 'FLASHCARD_1 environment variable not configured on the server.' });
        }

        if (!inputText && (!uploadedFiles || uploadedFiles.length === 0)) {
            return res.status(400).json({ error: 'Bad Request', message: 'Please provide text or upload files.' });
        }

        let chatHistory = [];
        let promptParts = [];

        // Add text input if available
        if (inputText) {
            promptParts.push({ text: `Here is some text content: "${inputText}"` });
        }

        // Add uploaded file content
        uploadedFiles.forEach(fileObj => {
            if (fileObj.type.startsWith('image/')) {
                promptParts.push({ text: `From the following image file (${fileObj.name}):` });
                promptParts.push({ inlineData: { mimeType: fileObj.type, data: fileObj.content } });
            } else if (fileObj.type.startsWith('text/') || fileObj.type === 'application/pdf') {
                promptParts.push({ text: `From the following text content (${fileObj.name}): "${fileObj.content}"` });
            }
        });

        // Explicitly tell the AI to combine information from all sources and ensure flashcards per file
        promptParts.push({ text: `\n\nGenerate a list of flashcards (front and back) from ALL the provided text and image content. It is crucial to **make sure at least one flashcard is generated for each distinct file or text input provided**, and ideally more. Ensure the 'front' is a question or term and the 'back' is its answer or definition. Aim for 5-10 flashcards per file/input if possible, or fewer if the content is short.` });

        if (customInstructions) {
            promptParts.push({ text: `\n\nAlso follow these specific instructions: "${customInstructions}"` });
        }

        promptParts.push({ text: `\n\nProvide the output as a JSON array of objects, where each object has 'front' and 'back' properties. Example JSON format:
[
  { "front": "What is photosynthesis?", "back": "The process used by plants to convert light energy into chemical energy." },
  { "front": "What are the key inputs for photosynthesis?", "back": "Carbon dioxide, water, and light energy." }
]`});

        chatHistory.push({ role: "user", parts: promptParts });

        const payload = {
            contents: chatHistory,
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
                        "propertyOrdering": ["front", "back"]
                    }
                }
            }
        };

        let modelsToTry = shuffleArray([...ALL_GEMINI_MODELS]);
        let success = false;
        let lastError = null;
        let flashcards = [];

        for (const modelName of modelsToTry) {
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
            console.log(`Attempting to generate flashcards with model: ${modelName}`);

            try {
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(`API error with ${modelName}: ${response.status} ${response.statusText} - ${JSON.stringify(errorData)}`);
                }

                const result = await response.json();

                if (result.candidates && result.candidates.length > 0 &&
                    result.candidates[0].content && result.candidates[0].content.parts &&
                    result.candidates[0].content.parts.length > 0) {
                    const jsonString = result.candidates[0].content.parts[0].text;
                    const parsedFlashcards = JSON.parse(jsonString);

                    if (parsedFlashcards.length > 0) {
                        flashcards = parsedFlashcards;
                        success = true;
                        break; // Exit loop on successful generation
                    } else {
                        console.warn(`Model ${modelName} generated an empty flashcard array.`);
                    }
                } else {
                    throw new Error(`Unexpected API response structure from ${modelName}.`);
                }
            } catch (error) {
                console.error(`Error with model ${modelName}:`, error);
                lastError = error;
            }
        }

        if (success) {
            res.status(200).json({ flashcards: flashcards });
        } else {
            res.status(500).json({ error: 'Flashcard Generation Failed', message: `Could not generate flashcards after trying all models. Last error: ${lastError ? lastError.message : 'Unknown error.'}` });
        }
    } catch (error) {
        console.error('Unhandled error in serverless function:', error);
        res.status(500).json({ error: 'Internal Server Error', message: error.message || 'An unexpected error occurred on the server.' });
    }
};
