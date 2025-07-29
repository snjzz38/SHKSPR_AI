// Humanizer_API.js
// This is your serverless function for humanizing text.
// It handles POST requests to interact with the Groq API.
// Uses built-in 'https' module to avoid external dependencies.

const https = require('https');
const querystring = require('querystring'); // Useful for handling potential URL encoding if needed

// Ensure you have your Groq API key set as an environment variable on Vercel named `Humanizer_1`.
const GROQ_API_KEY = process.env.Humanizer_1;
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
                // Try to parse JSON, but pass raw data if it fails
                try {
                    const jsonData = JSON.parse(data);
                    resolve({ statusCode: res.statusCode, headers: res.headers, body: jsonData });
                } catch (parseError) {
                    // If parsing fails, resolve with raw data and log warning
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


// This is the main handler function for the serverless endpoint.
module.exports = async function handler(req, res) {
    console.log('API function invoked. Request method:', req.method);

    // Only allow POST requests to this endpoint.
    if (req.method !== 'POST') {
        console.warn('Method Not Allowed:', req.method);
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // Ensure the API key is available.
    if (!GROQ_API_KEY) {
        console.error('Groq API key is not configured. Check Vercel Environment Variables (Humanizer_1).');
        return res.status(500).json({ error: 'Server configuration error: API key missing.' });
    }

    try {
        // Log the raw request body for debugging if parsing issues occur.
        console.log('Raw request body:', req.body);

        // Parse the request body. Vercel usually auto-parses JSON into req.body.
        // However, let's add a robust check.
        let requestData;
        if (typeof req.body === 'object' && req.body !== null) {
            // Already parsed by Vercel
            requestData = req.body;
        } else if (typeof req.body === 'string') {
            // If it's a string, parse it
            try {
                requestData = JSON.parse(req.body);
            } catch (parseErr) {
                console.error('Failed to parse incoming request body as JSON:', req.body);
                return res.status(400).json({ error: 'Invalid JSON in request body.' });
            }
        } else {
             console.error('Unexpected request body type:', typeof req.body, req.body);
             return res.status(400).json({ error: 'Request body must be JSON.' });
        }

        const { model, messages, temperature, top_p, max_tokens } = requestData || {};

        // Validate essential request body parameters.
        if (!model || !messages || !Array.isArray(messages)) { // Ensure messages is an array
            console.error('Validation Error: Missing required parameters in request body. Model:', model, 'Messages:', messages);
            return res.status(400).json({ error: 'Missing required parameters: model or messages (must be an array). Check request body format.' });
        }

        console.log('Making Groq API call with model:', model);

        // Prepare data for Groq API
        const postData = JSON.stringify({
            model: model,
            messages: messages,
            temperature: temperature,
            top_p: top_p,
            max_tokens: max_tokens,
            stream: false
        });

        // Configure HTTPS request options
        const options = {
            hostname: GROQ_API_HOST,
            port: 443,
            path: GROQ_API_PATH,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        // Make the API call to Groq using the helper function.
        const groqResponse = await httpsPostRequest(options, postData);

        console.log('Groq API response status:', groqResponse.statusCode);
        // console.log('Groq API response headers:', groqResponse.headers); // Uncomment for debugging headers
        // console.log('Groq API raw response body:', groqResponse.body); // Uncomment for debugging raw body

        // Check if the Groq API call was successful.
        if (groqResponse.statusCode < 200 || groqResponse.statusCode >= 300) {
            // The body might already be parsed JSON from the helper, or raw string if parsing failed
            const errorData = typeof groqResponse.body === 'object' ? groqResponse.body : { error: { message: 'Error from Groq API' } };
            console.error('Groq API error response:', groqResponse.statusCode, errorData);
            return res.status(groqResponse.statusCode).json({ error: errorData.error?.message || 'Error from Groq API' });
        }

        // If we got here, the status code was 2xx.
        // The body should be the successful JSON response from Groq.
        const data = groqResponse.body;
        console.log('Groq API successful response received.');

        // Send the Groq response back to the client.
        return res.status(200).json(data);

    } catch (error) {
        // Catch any unexpected errors during the process.
        console.error('Internal Server Error during API processing:', error);
        // Log the full error stack for better debugging.
        console.error(error.stack);
        return res.status(500).json({ error: 'Internal Server Error during API processing.' });
    }
};
