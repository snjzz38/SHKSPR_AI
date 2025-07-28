// api/get-configs.js
// This Vercel Serverless Function securely provides the Google API key
// from environment variables to the frontend.

export default function handler(request, response) {
    // Read environment variable for Google API key
    const googleApiKey = process.env.GOOGLE_API;

    // --- DEBUGGING LOGS (for Vercel runtime logs) ---
    console.log('--- Serverless Function Config Check ---');
    console.log('GOOGLE_API (googleApiKey):', googleApiKey ? `[Present] ${googleApiKey.substring(0, 5)}...` : '[NOT SET]');
    console.log('----------------------------------------------------');
    // --- END DEBUGGING LOGS ---

    // Basic validation for essential keys
    if (!googleApiKey) {
        console.error('Missing essential API key in environment variables: GOOGLE_API is [NOT SET]');
        response.status(500).json({ error: 'Server configuration error: Google API key missing.' });
        return;
    }

    // Set CORS headers for security and accessibility
    // In a production environment, consider restricting Access-Control-Allow-Origin
    // to your specific frontend domain(s) instead of '*'.
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');

    // Respond with the API key
    response.status(200).json({
        googleApiKey: googleApiKey
    });
}
