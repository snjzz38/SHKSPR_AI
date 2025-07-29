// File: AI_Humanizer/api/Humanizer_API.js
// Improved version based on insights from working example.
// Keeps existing project structure.
// Uses built-in 'https' module for compatibility.

const https = require('https');

// Ensure the Groq API key is set as an environment variable named `Humanizer_1`.
const GROQ_API_KEY = process.env.Humanizer_1;
const GROQ_API_HOST = 'api.groq.com';
const GROQ_API_PATH = '/openai/v1/chat/completions';

// --- Helper function to make HTTPS POST requests and return a Promise ---
// Simplified version based on working example's direct forwarding approach.
function httpsPostRequest(options, postData) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                // Try to parse JSON response from Groq
                let parsedBody;
                try {
                    parsedBody = JSON.parse(data);
                } catch (parseError) {
                    // If parsing fails, return raw data (could be plain text error)
                    console.warn('Groq response body was not valid JSON:', data.substring(0, 200)); // Log snippet
                    parsedBody = data; // Return raw data
                }
                // Resolve with status, headers, and (parsed or raw) body - similar to fetch response
                resolve({ statusCode: res.statusCode, headers: res.headers, body: parsedBody });
            });
        });

        req.on('error', (e) => {
            console.error('HTTPS Request Error:', e.message);
            reject(e); // Reject promise on network error
        });

        if (postData) {
            req.write(postData);
        }

        req.end();
    });
}

// --- Main handler function ---
// Using module.exports as per your current structure
module.exports = async function handler(req, res) {
    console.log('Humanizer_API.js invoked. Method:', req.method);

    // --- 1. Allow only POST requests (matching working example's implicit behavior) ---
    if (req.method !== 'POST') {
        console.warn('Method Not Allowed:', req.method);
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // --- 2. Check for API Key EARLY (matching working example's early check) ---
    if (!GROQ_API_KEY) {
        const errorMsg = 'Groq API key (Humanizer_1) is missing or empty in Vercel Environment Variables.';
        console.error('CONFIGURATION ERROR:', errorMsg);
        // Return 500 as in the working example for config issues
        return res.status(500).json({ error: 'Server configuration error: API key missing or empty.' });
    }
    console.log('Groq API Key found.');

    // --- 3. Validate Request Body (Simplified, similar to working example's check) ---
    // Check if body exists, is an object, and has required properties.
    if (!req.body || typeof req.body !== 'object' || !req.body.model || !req.body.messages) {
        const errorMsg = 'Invalid request body. Must be a JSON object with `model` and `messages` properties.';
        console.error('BODY VALIDATION ERROR:', errorMsg, 'Received body type:', typeof req.body);
        // Return 400 Bad Request as in the working example
        return res.status(400).json({ error: errorMsg });
    }
    console.log('Request body validated. Model:', req.body.model);

    try {
        // --- 4. Prepare data for Groq API (Forward req.body directly, like working example) ---
        // This matches the working example's approach of forwarding the entire body.
        const postData = JSON.stringify(req.body);
        console.log('Prepared request body for Groq API.');

        // --- 5. Configure HTTPS request options ---
        const options = {
            hostname: GROQ_API_HOST,
            port: 443,
            path: GROQ_API_PATH,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // Use the Bearer token format as expected by Groq
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                // Set Content-Length header
                'Content-Length': Buffer.byteLength(postData),
                // Adding a User-Agent is good practice
                'User-Agent': 'SHKSPR-Humanizer-App/1.0'
            }
        };
        console.log('Configured HTTPS request options.');

        // --- 6. Make the API call to Groq (using our helper) ---
        console.log('Making HTTPS request to Groq API...');
        const groqResponse = await httpsPostRequest(options, postData);
        console.log('Received response from Groq API. Status:', groqResponse.statusCode);

        // --- 7. Handle Groq API response (Matching working example's response handling) ---
        // Check if the Groq API call was successful (status code 2xx).
        if (groqResponse.statusCode < 200 || groqResponse.statusCode >= 300) {
            // Log the error details for debugging
            console.error(`Groq API Error (${groqResponse.statusCode}):`, groqResponse.body);

            // Prepare error message to send back to client
            let errorMessage = 'Error from Groq API';
            // If the body is an object (parsed JSON error), try to get a specific message
            if (typeof groqResponse.body === 'object' && groqResponse.body !== null) {
                errorMessage = groqResponse.body.error?.message || JSON.stringify(groqResponse.body);
            } else if (typeof groqResponse.body === 'string') {
                // If it's a string (raw error or failed parse), use it directly
                errorMessage = groqResponse.body || errorMessage;
            }

            // Return the error status and message from Groq, like the working example does
            return res.status(groqResponse.statusCode).json({
                error: errorMessage,
                // Optional: include the status code for frontend debugging
                groq_status: groqResponse.statusCode
            });
        }

        // --- 8. Success: Send Groq's successful JSON response back to the client ---
        // If status is 2xx, groqResponse.body should be the successful JSON data.
        const data = groqResponse.body;
        console.log('Groq API call successful.');
        return res.status(200).json(data); // Send data exactly as received from Groq

    } catch (error) {
        // --- 9. Catch any unexpected errors during processing ---
        console.error('!!! UNCAUGHT INTERNAL SERVER ERROR !!!');
        console.error('Error Details:', error.message);
        if (error.stack) {
            console.error('Error Stack:', error.stack);
        }
        // Return 500 Internal Server Error, like the working example
        return res.status(500).json({
            error: 'Internal Server Error during API processing.',
            internal_error: error.message // Optional detail for debugging
        });
    }
};
