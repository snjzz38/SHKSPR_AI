// api/Citation_API.js
const fetch = require('node-fetch');

const ALL_GEMINI_MODELS = [
  'gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.0-flash',
  'gemini-2.0-flash-lite', 'gemini-2.5-pro',
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
            url: url, title: titleMatch ? titleMatch[1] : null, // Return null if no title is found
            author: author, site_name: site_name, published_date: published_date, body_snippet: cleanText.substring(0, 2500)
        };
    } catch (error) { return null; }
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

        const summaryPrompt = `Summarize the following text into a single, effective search query of 10-15 words. The query should blend specific keywords with the broader theme to find a good variety of sources. Return ONLY the search query string. Text: "${essayText}"`;
        const summaryPayload = { contents: [{ role: 'user', parts: [{ text: summaryPrompt }] }] };
        const summaryData = await callGeminiApi(summaryPayload, geminiApiKey);
        const searchQuery = summaryData.candidates[0].content.parts[0].text.trim();
        if (!searchQuery) throw new Error("AI failed to generate a search query.");

        const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${searchApiKey}&cx=${searchEngineId}&q=${encodeURIComponent(searchQuery)}&num=10`;
        const searchApiResponse = await fetch(searchUrl);
        const searchData = await searchApiResponse.json();
        const searchResults = searchData.items ? searchData.items.map(item => item.link) : [];
        if (searchResults.length === 0) return res.status(200).json({ citations: ["No relevant sources were found."] });

        const fetchedContents = (await Promise.all(searchResults.map(url => fetchAndCleanContent(url)))).filter(Boolean);
        if (fetchedContents.length === 0) return res.status(200).json({ citations: ["Could not fetch content from any relevant sources."] });

        // --- THIS IS THE KEY CHANGE: The AI's rules are now extremely lenient ---
        const extractionPrompt = `
            You are a data extraction expert. Your task is to extract citation information from the provided webpage data.
            RULES:
            1.  Analyze the "Webpage Data" to find the author, title, and publication year for each source.
            2.  **NEW TITLE RULE:** If a usable title is found, use it. If the 'title' field is null or empty, you MUST use the source's 'url' as the title and append the string ' (NO TITLE)' to it. NEVER discard a source for lacking a title.
            3.  **LENIENT AUTHOR RULE:** If a specific person's name is not found for 'author', you MUST use the 'site_name' as a fallback. Do not leave the author blank if a site_name exists.
            4.  The 'year' should be extracted from the 'published_date' field or the text. If no year is found, use "n.d.".
            5.  Return ONLY a valid JSON array of objects. Each object must have these exact keys: "author", "title", "year", "url".

            Webpage Data:
            ${JSON.stringify(fetchedContents, null, 2)}
        `;
        const extractionPayload = { contents: [{ role: 'user', parts: [{ text: extractionPrompt }] }], generationConfig: { responseMimeType: "application/json" } };
        const extractionData = await callGeminiApi(extractionPayload, geminiApiKey);
        const structuredCitations = JSON.parse(extractionData.candidates[0].content.parts[0].text);

        if (!structuredCitations || structuredCitations.length === 0) {
            return res.status(200).json({ citations: ["No usable sources were found after filtering."] });
        }

        const countInstruction = `Return citations for as many sources as possible, up to a maximum of ${citationCount}. If you have fewer sources than the maximum, return all of them.`;
        const formattingPrompt = `
            You are an expert academic librarian. Your only task is to format the provided JSON data into a bibliography.
            RULES:
            1.  Format ALL citations in **${citationStyle.toUpperCase()}** style.
            2.  Order the final citations **alphabetically** by author.
            3.  ${countInstruction}
            4.  Return ONLY a valid JSON array of strings. Each string should be a complete, formatted citation.

            Source Data:
            ${JSON.stringify(structuredCitations, null, 2)}
        `;
        const formattingPayload = { contents: [{ role: 'user', parts: [{ text: formattingPrompt }] }], generationConfig: { responseMimeType: "application/json" } };
        const bibliographyData = await callGeminiApi(formattingPayload, geminiApiKey);
        const citations = JSON.parse(bibliographyData.candidates[0].content.parts[0].text);

        if (outputType === 'bibliography') {
            return res.status(200).json({ citations });
        }

        if (outputType === 'in-text') {
            const inTextPrompt = `
                You are an expert academic editor. Your primary goal is to insert correct, thorough in-text citations into an essay.
                RULES:
                1.  Carefully read the "Original Essay" and the "Bibliography" provided.
                2.  Your main task is to connect the claims in the essay to the sources in the bibliography.
                3.  You MUST insert an in-text citation (e.g., (Author, Year)) for **EVERY** source in the bibliography that is relevant to the essay's content. Be comprehensive.
                4.  The in-text citations MUST be in the correct **${citationStyle.toUpperCase()}** format.
                5.  **CRITICAL:** You must NOT change, rephrase, or alter the original essay text in any other way. Preserve it exactly as it is.
                6.  Before finishing, review the essay one last time to ensure all relevant sources from the bibliography have been cited.
                7.  Return ONLY the modified essay text as a single string.

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
