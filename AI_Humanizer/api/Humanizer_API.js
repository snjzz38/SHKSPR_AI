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

        // Make the API call to Groq
        const groqResponse = await httpsPostRequest({
            hostname: GROQ_API_HOST,
            port: 443,
            path: GROQ_API_PATH,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${GROQ_API_KEY}`
            }
        }, JSON.stringify({
            model,
            messages,
            temperature,
            top_p,
            max_tokens,
            stream: false
        }));

        // Check if the Groq API call was successful
        if (!groqResponse.ok) {
            const errorData = await groqResponse.json();
            console.error('Groq API error response:', groqResponse.status, errorData);
            return res.status(groqResponse.status).json({ error: errorData.error?.message || 'Error from Groq API' });
        }

        // Parse the successful response from Groq
        const data = await groqResponse.json();
        console.log('Groq API successful response received.');

        // Send the Groq response back to the client
        return res.status(200).json(data);

    } catch (error) {
        // Catch any unexpected errors during the process
        console.error('Internal Server Error during API processing:', error);
        // Log the full error stack for better debugging
        console.error(error.stack);
        return res.status(500).json({ error: 'Internal Server Error during API processing.' });
    }
};
