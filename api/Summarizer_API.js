// api/Summarizer_API.js

import fetch from 'node-fetch';

const GEMINI_API_KEY = process.env.SUMMARIZER_1;

const ALL_GEMINI_MODELS = [
    'gemini-2.5-pro',
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
const MAX_RETRIES = ALL_GEMINI_MODELS.length;

async function callGeminiApi(payload, modelType = 'text', retriesLeft = MAX_RETRIES, triedModels = new Set()) {
    if (!GEMINI_API_KEY) {
        throw new Error("Server-side Gemini API Key (SUMMARIZER_1) is not configured.");
    }

    let modelsToTry = ALL_GEMINI_MODELS.filter(model => !triedModels.has(model));

    if (modelsToTry.length === 0) {
        throw new Error('All available models have been tried and failed.');
    }

    const currentModel = modelsToTry[0];
    triedModels.add(currentModel);

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${GEMINI_API_KEY}`;

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: response.statusText }));
            const errorMessage = `API call failed with status ${response.status}: ${errorData.message || JSON.stringify(errorData)}`;
            throw new Error(errorMessage);
        }

        const result = await response.json();
        return result;

    } catch (error) {
        console.error(`Server-side API call error with model ${currentModel}:`, error);
        const isRetryableError = (error.message.includes('status 400') && 
                                    (error.message.includes('context window') || error.message.includes('too large') || error.message.includes('input_text_too_long'))) ||
                                 (error.message.includes('status 503') && error.message.includes('overloaded')) ||
                                 (error.message.includes('status 429'));

        if (isRetryableError && retriesLeft > 1) {
            const delay = 1500 * (MAX_RETRIES - retriesLeft + 1);
            console.warn(`Server-side retrying with another model in ${delay}ms... Retries left: ${retriesLeft - 1}`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return callGeminiApi(payload, modelType, retriesLeft - 1, triedModels);
        } else {
            throw error;
        }
    }
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        // Now, this API expects fileId (from Gemini Files API) or youtubeLink
        const { fileId, fileType, summarizationPrompt, youtubeLink } = req.body; // Added fileType for fileData

        let transcribedText;

        // Handle audio file processing via Gemini Files API
        if (fileId && fileType) { // Check for fileId instead of base64Audio
            // 1. Transcribe the audio using fileData
            const transcriptionPayload = {
                contents: [{
                    role: "user",
                    parts: [
                        { text: "Transcribe the following audio exactly as spoken:" },
                        {
                            fileData: { // Use fileData for Gemini Files API reference
                                mimeType: fileType, // Use the mimeType passed from frontend
                                fileUri: fileId // This is the 'files/XXXXXX' ID
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
            const getYouTubeVideoId = (url) => {
                const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
                const match = url.match(regExp);
                return (match && match[2].length === 11) ? match[2] : null;
            };
            const videoId = getYouTubeVideoId(youtubeLink);
            if (!videoId) {
                return res.status(400).json({ error: 'Invalid YouTube link or video ID could not be extracted.' });
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
            transcribedText = `Simulated transcript for YouTube video ID: ${videoId}\n\nThis is a demonstration of how YouTube transcript summarization would work. In a production environment, this text would be the actual transcript extracted from the YouTube video using a backend service that utilizes libraries like youtube-transcript-api (Python) or equivalent.`;

            if (!transcribedText || transcribedText.trim() === '') {
                throw new Error('Could not retrieve transcript for this video. It might not have captions enabled or the simulated fetch failed.');
            }
        } else {
            return res.status(400).json({ error: 'No audio file ID/type or YouTube link provided for processing.' });
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

        res.status(200).json({ transcribedText, summary });

    } catch (error) {
        console.error('Serverless function error:', error);
        res.status(500).json({ error: error.message || 'An unexpected error occurred during processing.' });
    }
}
