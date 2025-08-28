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

async function fetchAndCleanContent(url) {
    try {
        const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 5000 });
        if (!response.ok) return `Could not fetch content.`;
        const html = await response.text();
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        const metaDescriptionMatch = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i);
        const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
        const cleanText = (bodyMatch ? bodyMatch[1] : html).replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s\s+/g, ' ').trim();
        return { title: titleMatch ? titleMatch[1] : 'No title', meta_description: metaDescriptionMatch ? metaDescriptionMatch[1] : '', body_snippet: cleanText.substring(0, 2000) };
    } catch (error) { return `Content fetch failed.`; }
}

async function callGeminiApi(payload, apiKey) {
    let modelsToTry = shuffleArray([...ALL_GEMINI_MODELS]);
    let lastError = null;
    for (const currentModel of modelsToTry) {
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;
        try {
            const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
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

        // Step 1 & 2: Summarize and Search
        const summaryPrompt = `Summarize the following text into a single, concise search query of 10-15 words. Return ONLY the search query string. Text: "${essayText}"`;
        const summaryPayload = { contents: [{ role: 'user', parts: [{ text: summaryPrompt }] }] };
        const summaryData = await callGeminiApi(summaryPayload, geminiApiKey);
        const searchQuery = summaryData.candidates[0].content.parts[0].text.trim();
        if (!searchQuery) throw new Error("AI failed to generate a search query.");

        const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${searchApiKey}&cx=${searchEngineId}&q=${encodeURIComponent(searchQuery)}&num=10`;
        const searchApiResponse = await fetch(searchUrl);
        const searchData = await searchApiResponse.json();
        const searchResults = searchData.items ? searchData.items.map(item => item.link) : [];
        if (searchResults.length === 0) return res.status(200).json({ citations: ["No relevant sources were found."] });

        // Step 3: Fetch Content
        const fetchedContents = await Promise.all(searchResults.map(url => fetchAndCleanContent(url)));

        // Step 4: Generate Bibliography
        const countInstruction = citationCount === 'auto' ? `Return citations for all the most relevant sources.` : `Prioritize returning exactly ${citationCount} citations. If you cannot find enough high-quality, relevant sources, return as many as you can find.`;
        const bibliographyPrompt = `You are an expert academic librarian. Generate a complete bibliography. RULES: 1. Analyze the "Webpage Data" to find author, date, and title. 2. If info is missing, estimate (e.g., "n.d."). 3. Format ALL citations in **${citationStyle.toUpperCase()}** style. 4. Order citations **alphabetically**. 5. ${countInstruction} 6. Return ONLY a valid JSON array of strings. Webpage Data: ${JSON.stringify(fetchedContents, null, 2)}`;
        const bibliographyPayload = { contents: [{ role: 'user', parts: [{ text: bibliographyPrompt }] }], generationConfig: { responseMimeType: "application/json" } };
        const bibliographyData = await callGeminiApi(bibliographyPayload, geminiApiKey);
        const citations = JSON.parse(bibliographyData.candidates[0].content.parts[0].text);

        if (outputType === 'bibliography') {
            return res.status(200).json({ citations });
        }

        // --- NEW Step 5: Generate In-text Citations ---
        if (outputType === 'in-text') {
            const inTextPrompt = `
                You are an expert academic editor. Your task is to insert in-text citations into the provided essay.
                RULES:
                1.  Read the "Original Essay" and the "Bibliography".
                2.  Insert in-text citations (e.g., (Author, Year)) into the essay where the information from a source is likely used.
                3.  The in-text citations MUST be in the correct **${citationStyle.toUpperCase()}** format.
                4.  You MUST ONLY use sources from the provided "Bibliography".
                5.  **CRITICAL:** Do NOT change, rephrase, or alter the original essay text in any other way. Preserve it exactly.
                6.  Return ONLY the modified essay text as a single string.

                Bibliography:
                ${JSON.stringify(citations, null, 2)}

                Original Essay:
                "${essayText}"
            `;
            const inTextPayload = { contents: [{ role: 'user', parts: [{ text: inTextPrompt }] }] };
            const inTextData = await callGeminiApi(inTextPayload, geminiApiKey);
            const inTextCitedEssay = inTextData.candidates[0].content.parts[0].text;

            return res.status(200).json({ citations, inTextCitedEssay });
        }

    } catch (error) {
        console.error('Error in serverless function:', error);
        res.status(500).json({ error: 'Failed to generate citation.', details: error.message });
    }
};
