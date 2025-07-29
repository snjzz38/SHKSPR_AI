// This is your serverless function for humanizing text.
// It handles POST requests to interact with the Groq API.

// Import node-fetch for consistent fetch API behavior across environments.
// This is crucial for Vercel serverless functions.
const fetch = require('node-fetch');

// Ensure you have your Groq API key set as an environment variable on Vercel
// named `GROQ_API_KEY` or `Humanizer_1` as per previous discussions.
// For this example, we'll assume it's `Humanizer_1`.
const GROQ_API_KEY = process.env.Humanizer_1; // Using Humanizer_1 as per your current setup

// This is the main handler function for the serverless endpoint.
// Using module.exports for broader compatibility with Vercel's Node.js runtime.
module.exports = async function handler(req, res) {
    console.log('API function invoked. Request method:', req.method);

    // Only allow POST requests to this endpoint.
    if (req.method !== 'POST') {
        console.warn('Method Not Allowed:', req.method);
        // If any other method is used, return a 405 Method Not Allowed error.
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

        // Parse the request body to get the model, messages, and other parameters.
        // Vercel usually auto-parses JSON, but we'll add a check.
        const { model, messages, temperature, top_p, max_tokens } = req.body || {};

        // Validate essential request body parameters.
        if (!model || !messages) {
            console.error('Validation Error: Missing required parameters in request body. Model:', model, 'Messages:', messages);
            return res.status(400).json({ error: 'Missing required parameters: model or messages. Check request body format.' });
        }

        console.log('Making Groq API call with model:', model);

        // Make the API call to Groq.
        const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${GROQ_API_KEY}`
            },
            body: JSON.stringify({
                model: model,
                messages: messages,
                temperature: temperature,
                top_p: top_p,
                max_tokens: max_tokens,
                stream: false // Ensure streaming is false as per your client-side implementation
            })
        });

        // Check if the Groq API call was successful.
        if (!groqResponse.ok) {
            const errorData = await groqResponse.json();
            console.error('Groq API error response:', groqResponse.status, errorData);
            return res.status(groqResponse.status).json({ error: errorData.error?.message || 'Error from Groq API' });
        }

        // Parse the successful response from Groq.
        const data = await groqResponse.json();
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
