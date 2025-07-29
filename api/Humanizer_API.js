// File: AI_Humanizer/api/Humanizer_API.js

const https = require('https');

// Ensure you have your Groq API key set as an environment variable on Vercel named `HUMANIZER_1`.
const GROQ_API_KEY = process.env.HUMANIZER_1;
const GROQ_API_HOST = 'api.groq.com';
const GROQ_API_PATH = '/openai/v1/chat/completions';

// Helper function to make HTTPS POST requests and return a Promise
function httpsPostRequest(options, postData) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    const jsonData = JSON.parse(data);
                    // Resolve with an object containing status, headers, and parsed body
                    resolve({ statusCode: res.statusCode, headers: res.headers, body: jsonData });
                } catch (parseError) {
                    console.warn('Response body was not valid JSON:', data.substring(0, 200)); // Log snippet
                    // Resolve with status, headers, and raw body string if JSON parse fails
                    resolve({ statusCode: res.statusCode, headers: res.headers, body: data });
                }
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

// Main handler function
module.exports = async function handler(req, res) {
    console.log('API function invoked. Request method:', req.method);

    // Only allow POST requests
    if (req.method !== 'POST') {
        console.warn('Method Not Allowed:', req.method);
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // Ensure the API key is available
    if (!GROQ_API_KEY) {
        console.error('Groq API key is not configured. Check Vercel Environment Variables (HUMANIZER_1).');
        return res.status(500).json({ error: 'Server configuration error: API key missing.' });
    }

    try {
        // Log the raw request body for debugging if parsing issues occur
        console.log('Raw request body:', req.body);

        // Parse the request body to get the model, messages, and other parameters
        const { model, messages, temperature, top_p, max_tokens } = req.body || {};

        // Validate essential request body parameters
        if (!model || !messages) {
            console.error('Validation Error: Missing required parameters in request body. Model:', model, 'Messages:', messages);
            return res.status(400).json({ error: 'Missing required parameters: model or messages. Check request body format.' });
        }

        console.log('Making Groq API call with model:', model);

        // --- PREPARE DATA FOR GROQ ---
        const postData = JSON.stringify({
            model: model,
            messages: messages,
            temperature: temperature,
            top_p: top_p,
            max_tokens: max_tokens,
            stream: false
        });

        // --- MAKE THE API CALL TO GROQ ---
        const groqResponse = await httpsPostRequest({
            hostname: GROQ_API_HOST,
            port: 443,
            path: GROQ_API_PATH,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Length': Buffer.byteLength(postData),
                'User-Agent': 'SHKSPR-Humanizer-App/1.0'
            }
        }, postData);

        // --- HANDLE GROQ API RESPONSE CORRECTLY ---
        // groqResponse is the object returned by our httpsPostRequest helper:
        // { statusCode: number, headers: object, body: object|string }

        console.log('Groq API response status:', groqResponse.statusCode);
        // console.log('Groq API response headers:', groqResponse.headers); // Uncomment for debugging
        // console.log('Groq API response body (type):', typeof groqResponse.body); // Uncomment for debugging
        // console.log('Groq API response body (content):', JSON.stringify(groqResponse.body).substring(0, 500)); // Uncomment for debugging

        // Check if the Groq API call was successful (status code 2xx).
        // Use groqResponse.statusCode, NOT groqResponse.ok
        if (groqResponse.statusCode < 200 || groqResponse.statusCode >= 300) {
            // Prepare error message to send back to client
            let errorMessage = 'Error from Groq API';
            // If the body is an object (parsed JSON error), try to get a specific message
            if (typeof groqResponse.body === 'object' && groqResponse.body !== null) {
                errorMessage = groqResponse.body.error?.message || JSON.stringify(groqResponse.body);
            } else if (typeof groqResponse.body === 'string') {
                // If it's a string (raw error or failed parse), use it directly
                errorMessage = groqResponse.body || errorMessage;
            }

            console.error(`Groq API Error (${groqResponse.statusCode}):`, errorMessage);
            // Return the error status and message from Groq
            return res.status(groqResponse.statusCode).json({
                error: errorMessage,
                // Optional: include the status code for frontend debugging
                groq_status: groqResponse.statusCode
            });
        }

        // If status is 2xx, groqResponse.body should be the successful JSON data.
        // Use groqResponse.body directly, NOT groqResponse.json()
        const data = groqResponse.body;
        console.log('Groq API call successful.');
        // Send the Groq response back to the client
        return res.status(200).json(data);

    } catch (error) {
        // Catch any unexpected errors during the process
        console.error('Internal Server Error during API processing:', error.message);
        if (error.stack) {
            console.error('Error Stack:', error.stack);
        }
        return res.status(500).json({ error: 'Internal Server Error during API processing.', details: error.message });
    }
};
