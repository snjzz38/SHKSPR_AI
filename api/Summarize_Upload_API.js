// api/Summarize_Upload_API.js

import fetch from 'node-fetch';
// No longer need Busboy as we're not parsing multipart/form-data here anymore
// import Busboy from 'busboy'; 

// IMPORTANT: Your Gemini API Key should be set as an environment variable in Vercel.
const GEMINI_API_KEY = process.env.SUMMARIZER_1;

// We no longer need to disable bodyParser here, as this API will receive JSON
// with the GCS URI, not raw file data.
export const config = {
    api: {
        bodyParser: true, // Re-enable bodyParser or let Vercel default handle it
    },
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    if (!GEMINI_API_KEY) {
        return res.status(500).json({ error: "Server-side Gemini API Key (SUMMARIZER_1) is not configured." });
    }

    try {
        // This API now receives the GCS URI and original fileType from the frontend
        const { gcsUri, fileType } = req.body;

        if (!gcsUri || !fileType) {
            return res.status(400).json({ error: 'Missing gcsUri or fileType in request body.' });
        }

        // Register the GCS file with the Gemini Files API
        // The Gemini Files API will then internally access the GCS file.
        const registerFilePayload = {
            file: {
                displayName: `uploaded_audio_${Date.now()}`, // A display name for the file
                uri: gcsUri // The Google Cloud Storage URI
            }
        };

        const uploadUrl = `https://generativelanguage.googleapis.com/v1beta/files?key=${GEMINI_API_KEY}`;

        const registerResponse = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(registerFilePayload)
        });

        if (!registerResponse.ok) {
            const errorData = await registerResponse.json().catch(() => ({ message: registerResponse.statusText }));
            throw new Error(`Gemini Files API registration failed with status ${registerResponse.status}: ${errorData.message || JSON.stringify(errorData)}`);
        }

        const registerResult = await registerResponse.json();
        const fileId = registerResult.name; // This is the 'files/XXXXXX' ID from Gemini Files API

        res.status(200).json({ fileId });

    } catch (error) {
        console.error('Serverless Summarize_Upload_API error:', error);
        res.status(500).json({ error: error.message || 'An unexpected error occurred during file registration.' });
    }
}
