// api/GenerateSignedUrl_API.js

import { Storage } from '@google-cloud/storage';

// IMPORTANT: For local development, you might use a JSON key file.
// For Vercel deployment, you MUST use environment variables.
// Set these in your Vercel project settings:
// GOOGLE_CLOUD_PROJECT_ID: Your Google Cloud Project ID
// GOOGLE_CLOUD_BUCKET_NAME: The name of your GCS bucket for uploads
// GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY: The entire JSON content of your service account key, BASE64 encoded.
//    To get this:
//    1. Go to Google Cloud Console > IAM & Admin > Service Accounts.
//    2. Create a new service account or select an existing one.
//    3. Go to "Keys" tab, "Add Key" > "Create new key" > "JSON".
//    4. Download the JSON file.
//    5. Encode the *entire content* of this JSON file to Base64:
//       On Linux/macOS: `cat your-key-file.json | base64`
//       On Windows (PowerShell): `[System.Convert]::ToBase64String([System.IO.File]::ReadAllBytes(".\your-key-file.json"))`
//    6. Set the resulting Base64 string as the value for GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY in Vercel.

const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
const bucketName = process.env.GOOGLE_CLOUD_BUCKET_NAME;
const serviceAccountKeyBase64 = process.env.GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY;

let storage;

if (projectId && bucketName && serviceAccountKeyBase64) {
    try {
        const serviceAccountKey = JSON.parse(Buffer.from(serviceAccountKeyBase64, 'base64').toString('utf8'));
        storage = new Storage({
            projectId: projectId,
            credentials: {
                client_email: serviceAccountKey.client_email,
                private_key: serviceAccountKey.private_key,
            },
        });
    } catch (e) {
        console.error("Failed to parse Google Cloud Service Account Key:", e);
        storage = null; // Indicate failure to initialize storage
    }
} else {
    console.error("Missing Google Cloud environment variables for GCS upload.");
    storage = null;
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    if (!storage) {
        return res.status(500).json({ error: 'Google Cloud Storage not configured. Check serverless function logs.' });
    }

    const { fileName, contentType } = req.body;

    if (!fileName || !contentType) {
        return res.status(400).json({ error: 'Missing fileName or contentType.' });
    }

    const bucket = storage.bucket(bucketName);
    const file = bucket.file(fileName);

    try {
        const [url] = await file.getSignedUrl({
            version: 'v4',
            action: 'write',
            expires: Date.now() + 15 * 60 * 1000, // URL expires in 15 minutes
            contentType: contentType,
        });

        const gcsUri = `gs://${bucketName}/${fileName}`; // The URI for Gemini Files API

        res.status(200).json({ signedUrl: url, gcsUri: gcsUri });
    } catch (error) {
        console.error('Error generating signed URL:', error);
        res.status(500).json({ error: `Failed to generate signed URL: ${error.message}` });
    }
}
