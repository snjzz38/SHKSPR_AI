// api/Summarizer_API.js

// Import node-fetch for making HTTP requests in the Node.js environment
// Vercel's Node.js runtime supports fetch natively, but explicit import is good practice.
import fetch from 'node-fetch';

// IMPORTANT: Your Gemini API Key should be set as an environment variable in Vercel.
// Based on your input, your environment variable is named SUMMARIZER_1.
// Go to your Vercel project settings -> Environment Variables.
// Add a new variable with:
// Name: SUMMARIZER_1
// Value: YOUR_ACTUAL_GEMINI_API_KEY (e.g., AIzaSy... )
// This variable will be automatically available in the Vercel serverless function's environment.
const GEMINI_API_KEY = process.env.SUMMARIZER_1; // Updated to use SUMMARIZER_1

// List of Gemini models to use for text processing (transcription and summarization)
// These models are capable of handling multimodal input (like audio for transcription)
// and generating text output.
const ALL_GEMINI_MODELS = [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash-live',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-2.0-flash-live',
    'gemini-1.5-flash',
    'gemini-1.5-flash-8b',
    'gemini-1.5-pro'
];
// Maximum number of retries for API calls, using different models if a call fails.
const MAX_RETRIES = ALL_GEMINI_MODELS.length;

/**
 * Helper function to call the Gemini API with exponential backoff and model fallback.
 * @param {object} payload - The request payload for the Gemini API.
 * @param {string} modelType - 'text' or 'audio' (for logging purposes, not functional).
 * @param {number} retriesLeft - Number of retries remaining.
 * @param {Set<string>} triedModels - Set of models already attempted.
 * @returns {Promise<object>} The JSON response from the Gemini API.
 * @throws {Error} If API key is missing or all models fail.
 */
async function callGeminiApi(payload, modelType = 'text', retriesLeft = MAX_RETRIES, triedModels = new Set()) {
    // Ensure the API key is available in the serverless environment.
    if (!GEMINI_API_KEY) {
        throw new Error("Server-side Gemini API Key (SUMMARIZER_1) is not configured. Please set it as a Vercel environment variable.");
    }

    // Filter out models that have already been tried to avoid infinite loops on failures.
    let modelsToTry = ALL_GEMINI_MODELS.filter(model => !triedModels.has(model));

    // If no models are left to try, throw an error.
    if (modelsToTry.length === 0) {
        throw new Error('All available models have been tried and failed.');
    }

    // Select the first available model for the current attempt.
    const currentModel = modelsToTry[0];
    // Add the current model to the set of tried models.
    triedModels.add(currentModel);

    // Construct the API URL with the selected model and API key.
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${GEMINI_API_KEY}`;

    try {
        // Make the POST request to the Gemini API.
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        // Check if the response was successful (status 2xx).
        if (!response.ok) {
            // If not successful, parse the error data and throw an error.
            const errorData = await response.json().catch(() => ({ message: response.statusText }));
            const errorMessage = `API call failed with status ${response.status}: ${errorData.message || JSON.stringify(errorData)}`;
            throw new Error(errorMessage);
        }

        // Parse and return the successful JSON response.
        const result = await response.json();
        return result;

    } catch (error) {
        // Log the error for debugging.
        console.error(`Server-side API call error with model ${currentModel}:`, error);

        // Determine if the error is retryable (e.g., context window exceeded, server overloaded, rate limit).
        const isRetryableError = (error.message.includes('status 400') && 
                                    (error.message.includes('context window') || error.message.includes('too large') || error.message.includes('input_text_too_long'))) ||
                                 (error.message.includes('status 503') && error.message.includes('overloaded')) ||
                                 (error.message.includes('status 429')); // 429 is for Too Many Requests (rate limiting)

        // If retryable and retries are left, attempt to retry with a delay.
        if (isRetryableError && retriesLeft > 1) {
            const delay = 1500 * (MAX_RETRIES - retriesLeft + 1); // Exponential backoff
            console.warn(`Server-side retrying with another model in ${delay}ms... Retries left: ${retriesLeft - 1}`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return callGeminiApi(payload, modelType, retriesLeft - 1, triedModels);
        } else {
            // If not retryable or no retries left, re-throw the error.
            throw error;
        }
    }
}

/**
 * Vercel Serverless Function handler.
 * This function processes POST requests for audio transcription and summarization.
 * @param {object} req - The incoming request object.
 * @param {object} res - The outgoing response object.
 */
export default async function handler(req, res) {
    // Only allow POST requests.
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        // Destructure necessary data from the request body.
        const { fileType, base64Audio, summarizationPrompt, youtubeLink } = req.body;

        let transcribedText;

        // Handle audio file processing
        if (base64Audio && fileType) {
            // 1. Transcribe the audio using inlineData (current approach)
            // NOTE: For very large audio files, consider integrating the Gemini Files API
            // which allows you to upload files separately and reference them by ID,
            // potentially reducing token costs for the raw audio data. This would require
            // additional logic to upload the file to the Files API first.
            const transcriptionPayload = {
                contents: [{
                    role: "user",
                    parts: [
                        { text: "Transcribe the following audio exactly as spoken:" },
                        {
                            inlineData: {
                                mimeType: fileType,
                                data: base64Audio
                            }
                        }
                    ]
                }]
            };

            const transcriptionResult = await callGeminiApi(transcriptionPayload, 'audio');
            
            if (transcriptionResult.candidates && transcriptionResult.candidates.length > 0 &&
                transcriptionResult.candidates[0].content && transcriptionResult.candidates[0].content.parts &&
                transcriptionResult.candidates[0].content.parts.length > 0) {
                transcribedText = transcriptionResult.candidates[0].content.parts[0].text;
            } else {
                throw new Error("Gemini API did not return a valid transcription.");
            }
        } else if (youtubeLink) {
            // Handle YouTube link processing (simulated)
            // In a real application, this would involve a backend library
            // to fetch the YouTube transcript.
            const getYouTubeVideoId = (url) => {
                const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
                const match = url.match(regExp);
                return (match && match[2].length === 11) ? match[2] : null;
            };
            const videoId = getYouTubeVideoId(youtubeLink);
            if (!videoId) {
                return res.status(400).json({ error: 'Invalid YouTube link or video ID could not be extracted.' });
            }
            // Simulate fetching transcript
            await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate network delay
            transcribedText = `Simulated transcript for YouTube video ID: ${videoId}\n\nThis is a demonstration of how YouTube transcript summarization would work. In a production environment, this text would be the actual transcript extracted from the YouTube video using a backend service that utilizes libraries like youtube-transcript-api (Python) or equivalent.`;

            if (!transcribedText || transcribedText.trim() === '') {
                throw new Error('Could not retrieve transcript for this video. It might not have captions enabled or the simulated fetch failed.');
            }
        } else {
            return res.status(400).json({ error: 'No audio file or YouTube link provided for processing.' });
        }

        // 2. Summarize the transcribed text
        const summarizationPayload = {
            contents: [{
                role: "user",
                parts: [{ text: `${summarizationPrompt}\n${transcribedText}` }]
            }]
        };
        const summarizationResult = await callGeminiApi(summarizationPayload, 'text');

        let summary = "Could not generate summary.";
        if (summarizationResult.candidates && summarizationResult.candidates.length > 0 &&
            summarizationResult.candidates[0].content && summarizationResult.candidates[0].content.parts &&
            summarizationResult.candidates[0].content.parts.length > 0) {
            summary = summarizationResult.candidates[0].content.parts[0].text;
        } else {
            throw new Error("Gemini API did not return a valid summary.");
        }

        // Send back the transcribed text and the summary to the frontend.
        res.status(200).json({ transcribedText, summary });

    } catch (error) {
        // Log the serverless function error and send a 500 status.
        console.error('Serverless function error:', error);
        res.status(500).json({ error: error.message || 'An unexpected error occurred during processing.' });
    }
}
