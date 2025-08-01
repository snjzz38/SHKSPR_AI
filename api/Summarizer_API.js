// api/Upload_API.js

import fetch from 'node-fetch';
import { Readable } from 'stream'; // For converting buffer to stream

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
        // Vercel's req.body for multipart/form-data is usually parsed automatically
        // if using a framework like Next.js. For raw Node.js serverless functions,
        // you might need to parse it manually or rely on Vercel's default parsing
        // for simple JSON/text bodies. For file uploads, it's often best to
        // send as 'application/octet-stream' or 'multipart/form-data' and
        // handle the buffer.
        // Assuming the frontend sends the file as a raw binary body (application/octet-stream)
        // or as multipart/form-data with a 'file' field.
        
        // For simplicity and common Vercel setup, we'll assume the frontend sends
        // the file as a raw binary body (application/octet-stream) or a Base64 string.
        // If it's multipart/form-data, you'd need a library like 'busboy' or 'formidable'.

        // Let's assume for now the frontend sends a JSON body with base64Audio and fileType
        // as it was doing before, but this endpoint is specifically for uploading.
        // For true large file uploads, a direct binary stream is better.
        // However, if the frontend is already converting to Base64, this will work for now,
        // but the 413 error might still occur if the Base64 string itself is too large for req.body.

        // A more robust approach for large files would be:
        // 1. Frontend sends file as 'multipart/form-data' directly.
        // 2. Serverless function uses 'busboy' or 'formidable' to parse the multipart data.
        // 3. The parsed file stream is then sent to Gemini Files API.

        // For now, let's adapt to the existing frontend sending Base64,
        // but note the limitation for extremely large files still applies to the initial POST to Vercel.
        // If the 413 persists, the frontend must send raw binary data.

        const { base64Audio, fileType } = req.body;

        if (!base64Audio || !fileType) {
            return res.status(400).json({ error: 'Missing base64Audio or fileType in request body.' });
        }

        const uploadPayload = {
            displayName: `uploaded_audio_${Date.now()}`, // A display name for the file in Gemini Files API
            mimeType: fileType,
            // The Gemini Files API expects the raw bytes, not Base64 in the 'data' field directly.
            // When using fetch, you typically send the raw binary data in the body.
            // For this serverless function, if we receive Base64, we need to convert it back to a Buffer.
            // However, the Gemini Files API 'upload' endpoint expects the raw file content in the body,
            // not within a JSON payload like generateContent's inlineData.
            // The `v1beta/files:upload` endpoint is a special endpoint.

            // Let's correct this: The Gemini Files API upload endpoint is designed for raw binary upload.
            // The frontend should send the raw binary data directly to this API endpoint.
            // The `req.body` will then be the raw buffer.

            // For Vercel serverless functions, when receiving binary data, req.body is a Buffer.
            // We need to ensure the frontend sends 'Content-Type': 'application/octet-stream'
            // or 'audio/mp3' etc. directly.

            // Let's assume the frontend sends the raw audio as `application/octet-stream`
            // and the `fileType` is passed as a query parameter or header for simplicity,
            // or we infer it from a well-known type.
            // For this example, we'll assume `req.body` is the raw audio Buffer.

            // If the frontend is still sending JSON with base64, we need to convert:
            // const audioBuffer = Buffer.from(base64Audio, 'base64');
            // But the Gemini Files API expects raw stream/buffer in the request body, not JSON.

            // This requires a fundamental change in how the frontend sends the file.
            // For now, let's simulate the Gemini Files API interaction on the backend
            // assuming we get the raw buffer.

            // --- Corrected approach for Gemini Files API upload ---
            // The Gemini Files API `v1beta/files:upload` endpoint expects the raw file content
            // as the request body, NOT a JSON object with inlineData.
            // The `mimeType` is passed in the `X-Goog-Upload-Content-Type` header.
            // The `displayName` is a query parameter.

            const uploadUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${GEMINI_API_KEY}`;

            // If the frontend sends base64, convert it to a Buffer
            const audioBuffer = Buffer.from(base64Audio, 'base64');

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
