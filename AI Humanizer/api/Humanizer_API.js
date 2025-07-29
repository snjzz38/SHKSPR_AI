// This is your serverless function for humanizing text.
// It handles POST requests to interact with the Groq API.

// Ensure you have your Groq API key set as an environment variable on Vercel
// named `GROQ_API_KEY` or `Humanizer_1` as per previous discussions.
// For this example, we'll assume it's `GROQ_API_KEY`.
const GROQ_API_KEY = process.env.GROQ_API_KEY || process.env.Humanizer_1;

// This is the main handler function for the serverless endpoint.
// Using module.exports for broader compatibility with Vercel's Node.js runtime.
module.exports = async function handler(req, res) {
    // Only allow POST requests to this endpoint.
    if (req.method !== 'POST') {
        // If any other method is used, return a 405 Method Not Allowed error.
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // Ensure the API key is available.
    if (!GROQ_API_KEY) {
        console.error('Groq API key is not configured.');
        return res.status(500).json({ error: 'Server configuration error: API key missing.' });
    }

    try {
        // Parse the request body to get the model, messages, and other parameters.
        const { model, messages, temperature, top_p, max_tokens } = req.body;

        // Validate essential request body parameters.
        if (!model || !messages) {
            return res.status(400).json({ error: 'Missing required parameters: model or messages.' });
        }

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
            console.error('Groq API error:', errorData);
            return res.status(groqResponse.status).json({ error: errorData.error?.message || 'Error from Groq API' });
        }

        // Parse the successful response from Groq.
        const data = await groqResponse.json();

        // Send the Groq response back to the client.
        return res.status(200).json(data);

    } catch (error) {
        // Catch any unexpected errors during the process.
        console.error('Server error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};
