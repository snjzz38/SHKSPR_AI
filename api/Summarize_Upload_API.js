// api/Summarize_Upload_API.js

import fetch from 'node-fetch';

// IMPORTANT: Your Gemini API Key should be set as an environment variable in Vercel.
// Based on your input, your environment variable is named SUMMARIZER_1.
// Go to your Vercel project settings -> Environment Variables.
// Name: SUMMARIZER_1
// Value: YOUR_ACTUAL_GEMINI_API_KEY (e.g., AIzaSy... )
const GEMINI_API_KEY = process.env.SUMMARIZER_1;

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    if (!GEMINI_API_KEY) {
        return res.status(500).json({ error: "Server-side Gemini API Key (SUMMARIZER_1) is not configured." });
    }

    try {
        // When the frontend sends `body: file` and `Content-Type: file.type`,
        // Vercel's serverless function receives the raw binary data in `req.body` as a Buffer.
        const audioBuffer = req.body; // req.body is already a Buffer for raw binary uploads
        const fileType = req.headers['content-type']; // Get the MIME type from the request headers

        if (!audioBuffer || !fileType) {
            return res.status(400).json({ error: 'Missing audio data or content-type in request.' });
        }

        const uploadUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${GEMINI_API_KEY}`;

        const uploadResponse = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
                'X-Goog-Upload-Protocol': 'raw', // Indicates raw upload
                'X-Goog-Upload-Content-Type': fileType, // Original MIME type of the audio
                'Content-Type': fileType // Also set Content-Type for the request body
            },
            body: audioBuffer // Send the raw audio buffer as the body
        });

        if (!uploadResponse.ok) {
            const errorData = await uploadResponse.json().catch(() => ({ message: uploadResponse.statusText }));
            throw new Error(`Gemini Files API upload failed with status ${uploadResponse.status}: ${errorData.message || JSON.stringify(errorData)}`);
        }

        const uploadResult = await uploadResponse.json();
        const fileId = uploadResult.file.name; // This is the 'files/XXXXXX' ID

        res.status(200).json({ fileId });

    } catch (error) {
        console.error('Serverless Upload API error:', error);
        res.status(500).json({ error: error.message || 'An unexpected error occurred during file upload.' });
    }
}
