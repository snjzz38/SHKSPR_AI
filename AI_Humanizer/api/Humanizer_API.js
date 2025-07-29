// Humanizer_API.js
// This is your serverless function for humanizing text.
// It handles POST requests to interact with the Groq API.
// Uses built-in 'https' module to avoid external dependencies.

const https = require('https');

// Ensure you have your Groq API key set as an environment variable on Vercel named `Humanizer_1`.
const GROQ_API_KEY = process.env.Humanizer_1;
const GROQ_API_HOST = 'api.groq.com';
const GROQ_API_PATH = '/openai/v1/chat/completions';

// --- Helper function to make HTTPS POST requests and return a Promise ---
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
                    resolve({ statusCode: res.statusCode, headers: res.headers, body: jsonData });
                } catch (parseError) {
                    console.warn('Response body was not valid JSON:', data);
                    resolve({ statusCode: res.statusCode, headers: res.headers, body: data });
                }
            });
        });

        req.on('error', (e) => {
            console.error('HTTPS Request Error:', e);
            reject(e);
        });

        if (postData) {
            req.write(postData);
        }

        req.end();
    });
}

// --- Main handler function ---
module.exports = async function handler(req, res) {
    // --- CRITICAL: Add extensive logging at the very start ---
    console.log('--- Humanizer_API.js INVOKED ---');
    console.log('Request Method:', req.method);
    console.log('Request Headers:', JSON.stringify(req.headers, null, 2)); // Log headers for Content-Type etc.
    console.log('Raw Request Body Type:', typeof req.body);
    console.log('Raw Request Body (first 1000 chars):', JSON.stringify(req.body)?.substring(0, 1000)); // Log beginning of body

    // 1. Only allow POST requests
    if (req.method !== 'POST') {
        console.warn('Method Not Allowed:', req.method);
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // 2. Check API Key EARLY and log status
    if (!GROQ_API_KEY) {
        const errorMsg = 'Groq API key (Humanizer_1) is not configured or is empty in Vercel Environment Variables.';
        console.error('CONFIGURATION ERROR:', errorMsg);
        return res.status(500).json({ error: 'Server configuration error: API key missing or empty.' });
    } else {
         console.log('Groq API Key found (length):', GROQ_API_KEY.length); // Log key length for confirmation, never the key itself
    }

    let requestData;

    try {
        // 3. Robustly parse the request body
        // Vercel *should* parse JSON based on Content-Type, but let's be very defensive.
        if (req.body === undefined || req.body === null) {
            // Body is completely missing
            const errorMsg = 'Request body is missing.';
            console.error('BODY ERROR:', errorMsg);
            return res.status(400).json({ error: errorMsg });
        } else if (typeof req.body === 'object') {
            // Vercel likely parsed it correctly
            console.log('Request body appears to be pre-parsed JSON object.');
            requestData = req.body;
        } else if (typeof req.body === 'string') {
            // It's a raw string, we need to parse it
            console.log('Request body is a raw string, attempting to parse as JSON...');
            if (req.body.trim() === '') {
                const errorMsg = 'Request body is an empty string.';
                console.error('BODY ERROR:', errorMsg);
                return res.status(400).json({ error: errorMsg });
            }
            requestData = JSON.parse(req.body);
            console.log('Successfully parsed request body string to JSON object.');
        } else {
            // Unexpected type (e.g., number, boolean)
            const errorMsg = `Unexpected request body type: ${typeof req.body}`;
            console.error('BODY ERROR:', errorMsg, 'Value:', req.body);
            return res.status(400).json({ error: `Bad Request: ${errorMsg}` });
        }
    } catch (parseErr) {
        const errorMsg = `Failed to parse request body as JSON: ${parseErr.message}`;
        console.error('BODY PARSING ERROR:', errorMsg);
        console.error('Problematic body content (first 500 chars):', JSON.stringify(req.body)?.substring(0, 500));
        return res.status(400).json({ error: 'Invalid JSON in request body.', details: errorMsg });
    }

    // 4. Validate parsed data
    const { model, messages, temperature, top_p, max_tokens } = requestData || {};
    if (!model || !messages || !Array.isArray(messages)) {
        const errorMsg = 'Validation Error: Missing or invalid required parameters in request body.';
        console.error('VALIDATION ERROR:', errorMsg, 'Model:', model, 'Messages Type:', typeof messages, 'Messages:', messages);
        return res.status(400).json({
            error: 'Missing required parameters: model or messages (must be an array). Check request body format.',
            receivedData: { model: model, messagesType: typeof messages, messagesLength: Array.isArray(messages) ? messages.length : 'N/A' } // Send back minimal debug info
        });
    }

    console.log('Validation passed. Model:', model, 'Messages length:', messages.length);

    try {
        // 5. Prepare data for Groq API
        const postData = JSON.stringify({
            model: model,
            messages: messages,
            temperature: temperature,
            top_p: top_p,
            max_tokens: max_tokens,
            stream: false
        });
        console.log('Prepared Groq API request data (model, message count).');

        // 6. Configure HTTPS request options
        const options = {
            hostname: GROQ_API_HOST,
            port: 443,
            path: GROQ_API_PATH,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${GROQ_API_KEY}`, // Make sure this header is being set
                'Content-Length': Buffer.byteLength(postData),
                'User-Agent': 'SHKSPR-Humanizer-App/1.0' // Adding a User-Agent is good practice
            }
        };
        console.log('Configured HTTPS request options.');

        // 7. Make the API call to Groq
        console.log('Making HTTPS request to Groq API...');
        const groqResponse = await httpsPostRequest(options, postData);
        console.log('Received response from Groq API. Status:', groqResponse.statusCode);

        // 8. Handle Groq API response
        if (groqResponse.statusCode < 200 || groqResponse.statusCode >= 300) {
            const errorData = typeof groqResponse.body === 'object' ? groqResponse.body : { error: { message: 'Error from Groq API' } };
            const errorMessage = errorData.error?.message || 'Unknown error from Groq API';
            console.error('Groq API ERROR Response:', groqResponse.statusCode, errorMessage);
            // Include status and message from Groq for better client-side debugging
            return res.status(groqResponse.statusCode).json({ error: errorMessage, groq_status: groqResponse.statusCode });
        }

        // 9. Success: Send Groq response back
        const data = groqResponse.body;
        console.log('Groq API call successful.');
        return res.status(200).json(data);

    } catch (error) {
        // 10. Catch any unexpected errors during processing or the HTTPS request
        console.error('!!! UNCAUGHT INTERNAL SERVER ERROR !!!');
        console.error('Error Details:', error);
        if (error.stack) {
            console.error('Error Stack:', error.stack);
        }
        return res.status(500).json({ error: 'Internal Server Error during API processing.', internal_error: error.message });
    } finally {
        console.log('--- Humanizer_API.js FINISHED ---');
    }
};
