const fetch = require('node-fetch');

// --- IMPROVEMENT 3: Updated Gemini Models ---
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
        if (!response.ok) return null;
        const html = await response.text();
        const getMetaContent = (name) => {
            const metaMatch = html.match(new RegExp(`<meta\\s+(?:name|property)="${name}"\\s+content="([^"]*)"`, 'i'));
            return metaMatch ? metaMatch[1] : '';
        };
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
        const cleanText = (bodyMatch ? bodyMatch[1] : html).replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s\s+/g, ' ').trim();
        const author = getMetaContent('author') || getMetaContent('og:author');
        const site_name = getMetaContent('og:site_name');
        const published_date = getMetaContent('article:published_time') || getMetaContent('publish_date') || getMetaContent('date');
        return {
            url: url, title: titleMatch ? titleMatch[1] : 'No title found', author: author,
            site_name: site_name, published_date: published_date, body_snippet: cleanText.substring(0, 2500)
        };
    } catch (error) { return null; }
}

async function callGeminiApi(payload, apiKey) {
    let modelsToTry = shuffleArray([...ALL_GEMINI_MODELS]);
    let lastError = null;
    for (const currentModel of modelsToTry) {
        const apiUrl = `httpshttps://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;
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
        // --- IMPROVEMENT 1: Backend now receives prompts and data from the frontend ---
        const { summaryPrompt, extractionPromptTemplate, formattingPromptTemplate, inTextPromptTemplate, essayText, citationStyle, outputType, citationCount } = req.body;
        if (!essayText || !summaryPrompt) return res.status(400).json({ error: 'Missing required fields from frontend.' });

        const summaryPayload = { contents: [{ role: 'user', parts: [{ text: summaryPrompt }] }] };
        const summaryData = await callGeminiApi(summaryPayload, geminiApiKey);
        const searchQuery = summaryData.candidates[0].content.parts[0].text.trim();
        if (!searchQuery) throw new Error("AI failed to generate a search query.");

        const searchUrl = `httpshttps://www.googleapis.com/customsearch/v1?key=${searchApiKey}&cx=${searchEngineId}&q=${encodeURIComponent(searchQuery)}&num=10`;
        const searchApiResponse = await fetch(searchUrl);
        const searchData = await searchApiResponse.json();
        const searchResults = searchData.items ? searchData.items.map(item => item.link) : [];
        if (searchResults.length === 0) return res.status(200).json({ citations: ["No relevant sources were found."] });

        const fetchedContents = (await Promise.all(searchResults.map(url => fetchAndCleanContent(url)))).filter(Boolean);
        if (fetchedContents.length === 0) return res.status(200).json({ citations: ["Could not fetch content from any relevant sources."] });

        const extractionPrompt = extractionPromptTemplate.replace('${JSON_PLACEHOLDER}', JSON.stringify(fetchedContents, null, 2));
        const extractionPayload = { contents: [{ role: 'user', parts: [{ text: extractionPrompt }] }], generationConfig: { responseMimeType: "application/json" } };
        const extractionData = await callGeminiApi(extractionPayload, geminiApiKey);
        const structuredCitations = JSON.parse(extractionData.candidates[0].content.parts[0].text);

        if (!structuredCitations || structuredCitations.length === 0) {
            return res.status(200).json({ citations: ["No high-quality, citable sources were found."] });
        }

        const formattingPrompt = formattingPromptTemplate
            .replace('${STYLE_PLACEHOLDER}', citationStyle.toUpperCase())
            .replace('${COUNT_PLACEHOLDER}', citationCount)
            .replace('${JSON_PLACEHOLDER}', JSON.stringify(structuredCitations, null, 2));
        const formattingPayload = { contents: [{ role: 'user', parts: [{ text: formattingPrompt }] }], generationConfig: { responseMimeType: "application/json" } };
        const bibliographyData = await callGeminiApi(formattingPayload, geminiApiKey);
        const citations = JSON.parse(bibliographyData.candidates[0].content.parts[0].text);

        if (outputType === 'bibliography') {
            return res.status(200).json({ citations });
        }

        if (outputType === 'in-text') {
            const inTextPrompt = inTextPromptTemplate
                .replace('${STYLE_PLACEHOLDER}', citationStyle.toUpperCase())
                .replace('${BIBLIOGRAPHY_PLACEHOLDER}', JSON.stringify(citations, null, 2))
                .replace('${ESSAY_PLACEHOLDER}', essayText);
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
