// api/Citation_API.js
const fetch = require('node-fetch');

const ALL_GEMINI_MODELS = [
  'gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.0-flash',
  'gemini-2.0-flash-lite', 'gemini-1.5-flash', 'gemini-1.5-flash-8b',
];

const shuffleArray = (array) => {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
};

// --- NEW: Helper function to fetch and clean webpage content ---
async function fetchAndCleanContent(url) {
    try {
        const response = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' },
            timeout: 5000 // 5-second timeout per fetch
        });
        if (!response.ok) return `Could not fetch content (status: ${response.status}).`;
        
        const html = await response.text();
        
        // Extract key metadata from the <head> for accuracy
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        const metaDescriptionMatch = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i);

        // Clean the body text
        const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
        const cleanText = (bodyMatch ? bodyMatch[1] : html)
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s\s+/g, ' ')
            .trim();

        return {
            title: titleMatch ? titleMatch[1] : 'No title found',
            meta_description: metaDescriptionMatch ? metaDescriptionMatch[1] : '',
            body_snippet: cleanText.substring(0, 2000) // Limit to first 2000 chars for efficiency
        };
    } catch (error) {
        console.warn(`Failed to fetch ${url}: ${error.message}`);
        return `Content fetch failed for this URL.`;
    }
}

async function callGeminiApi(payload, apiKey) {
    let modelsToTry = shuffleArray([...ALL_GEMINI_MODELS]);
    let lastError = null;
    for (const currentModel of modelsToTry) {
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;
        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(`API call with ${currentModel} failed: ${errorData.error?.message || response.statusText}`);
            }
            const result = await response.json();
            const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text && text.trim() !== '') return result;
            throw new Error(`Model ${currentModel} returned an empty response.`);
        } catch (error) {
            console.warn(error.message);
            lastError = error;
        }
    }
    throw lastError || new Error("All API models failed.");
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const geminiApiKey = process.env.CITATION_1;
    const searchApiKey = process.env.SEARCH_1;
    const searchEngineId = "e5f6f17d0ff2a4ac3";

    if (!geminiApiKey || !searchApiKey) {
        return res.status(500).json({ error: 'Server configuration error: API keys are missing.' });
    }

    try {
        const { essayText, citationStyle, outputType, citationCount } = req.body;
        if (!essayText) return res.status(400).json({ error: 'Missing required field: essayText.' });

        // Step 1: Generate Search Query
        const summaryPrompt = `Summarize the following text into a single, concise search query of 10-15 words. Return ONLY the search query string. Text: "${essayText}"`;
        const summaryPayload = { contents: [{ role: 'user', parts: [{ text: summaryPrompt }] }] };
        const summaryData = await callGeminiApi(summaryPayload, geminiApiKey);
        const searchQuery = summaryData.candidates[0].content.parts[0].text.trim();
        if (!searchQuery) throw new Error("AI failed to generate a search query.");

        // Step 2: Google Search
        const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${searchApiKey}&cx=${searchEngineId}&q=${encodeURIComponent(searchQuery)}`;
        const searchApiResponse = await fetch(searchUrl);
        const searchData = await searchApiResponse.json();
        const searchResults = searchData.items ? searchData.items.slice(0, 5).map(item => item.link) : []; // Get top 5 URLs

        if (searchResults.length === 0) {
            return res.status(200).json({ citations: ["No relevant sources were found."] });
        }

        // --- NEW Step 3: Fetch Content from URLs ---
        const fetchedContents = await Promise.all(
            searchResults.map(async (url) => ({
                url: url,
                content: await fetchAndCleanContent(url)
            }))
        );

        // --- NEW Step 4: Generate Final Citations from Full Context ---
        const countInstruction = (citationCount === 'auto')
            ? `Return citations for all the most relevant sources.`
            : `Return a maximum of ${citationCount} of the most relevant citations.`;

        const finalPrompt = `
            You are an expert academic librarian. Your task is to generate a complete bibliography from the provided webpage content.

            RULES:
            1.  For each "Webpage Data" object, meticulously analyze its "content" to find the true author(s), the exact publication date, and the full article title. The content includes the page title, meta description, and a snippet of the body text.
            2.  If an author is not listed, use the organization or website name. If a date is not found, use "n.d.".
            3.  Format ALL citations in the **${citationStyle.toUpperCase()}** style.
            4.  Order the final list of citations **alphabetically**.
            5.  ${countInstruction}
            6.  Return ONLY a valid JSON array of strings. Each string is a single, fully formatted citation. Do not include sources that are irrelevant to the original essay topic.

            Original Essay Topic (for context): "${searchQuery}"

            Webpage Data:
            ${JSON.stringify(fetchedContents, null, 2)}

            Return ONLY a valid JSON array of formatted citation strings.
        `;
        
        const finalPayload = {
            contents: [{ role: 'user', parts: [{ text: finalPrompt }] }],
            generationConfig: { responseMimeType: "application/json" }
        };

        const finalData = await callGeminiApi(finalPayload, geminiApiKey);
        const citations = JSON.parse(finalData.candidates[0].content.parts[0].text);

        res.status(200).json({ citations });

    } catch (error) {
        console.error('Error in serverless function:', error);
        res.status(500).json({ error: 'Failed to generate citation.', details: error.message });
    }
};
