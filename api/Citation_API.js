const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getJson } = require("serpapi"); // or another search library

// IMPORTANT: Never expose API keys in client-side code.
// In a real environment, these would be loaded from environment variables.
const GEMINI_API_KEY = process.env.CITATION_1 || "YOUR_GEMINI_API_KEY";
const SERP_API_KEY = process.env.SEARCH_1 || "YOUR_SERP_API_KEY";

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const app = express();
app.use(express.json());

app.post('/api/generate-citations', async (req, res) => {
    try {
        const { prompt, query } = req.body;

        if (!prompt || !query) {
            return res.status(400).json({ error: 'Prompt and query are required in the request body.' });
        }
        
        // Use SerpApi to get real-time search results
        const searchResponse = await getJson("google", {
            q: query,
            api_key: SERP_API_KEY,
        });

        // Extract snippets from organic results
        const snippets = searchResponse["organic_results"]
            .map(result => `Title: ${result.title}\nSource: ${result.source}\nLink: ${result.link}\nSnippet: ${result.snippet}`)
            .join('\n\n');

        // Create a new prompt that includes the search results
        const fullPrompt = `${prompt}\n\nWeb Search Results:\n---\n${snippets}\n---`;

        // The Gemini model is called with the full prompt
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-preview-05-20" });
        const result = await model.generateContent(fullPrompt);
        const response = result.response;
        const text = response.text();

        res.json({ text });

    } catch (error) {
        console.error('Error in serverless function:', error);
        res.status(500).json({ error: 'An internal server error occurred.' });
    }
});

// For local testing
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
