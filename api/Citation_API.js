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
        if (!response.ok) return null;
        const html = await response.text();
        const getMetaContent = (name) => {
            const metaMatch = html.match(new RegExp(`<meta\\s+(?:name|property)="${name}"\\s+content="([^"]*)"`, 'i'));
            return metaMatch ? metaMatch[1] : '';
        };
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        const site_name = getMetaContent('og:site_name');
        return {
            url: url,
            title: titleMatch ? titleMatch[1].trim() : null,
            author: getMetaContent('author') || getMetaContent('og:author'),
            site_name: site_name,
            published_date: getMetaContent('article:published_time') || getMetaContent('publish_date') || getMetaContent('date')
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

        // --- SAFETY NET 1: GUARANTEED SEARCH QUERY ---
        let searchQuery = '';
        try {
            const summaryPrompt = `Summarize the following text into a single, effective search query of 10-15 words. Return ONLY the search query string. Text: "${essayText}"`;
            const summaryPayload = { contents: [{ role: 'user', parts: [{ text: summaryPrompt }] }] };
            const summaryData = await callGeminiApi(summaryPayload, geminiApiKey);
            searchQuery = summaryData.candidates[0].content.parts[0].text.trim();
            if (!searchQuery) throw new Error("AI returned empty query.");
        } catch (error) {
            console.warn("AI query generation failed. Using fallback.", error);
            searchQuery = essayText.split(' ').slice(0, 20).join(' '); // Fallback to first 20 words
        }

        const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${searchApiKey}&cx=${searchEngineId}&q=${encodeURIComponent(searchQuery)}&num=10`;
        const searchApiResponse = await fetch(searchUrl);
        const searchData = await searchApiResponse.json();
        const searchResults = searchData.items ? searchData.items.map(item => item.link) : [];
        
        // This is now the only condition that can result in this message.
        if (searchResults.length === 0) {
            return res.status(200).json({ citations: ["Could not find any web pages for the given text. Please try rephrasing."] });
        }

        const fetchedContents = (await Promise.all(searchResults.map(url => fetchAndCleanContent(url)))).filter(Boolean);
        if (fetchedContents.length === 0) {
            // If fetching fails, return the raw URLs so the user still gets something.
            return res.status(200).json({ citations: searchResults.map(url => `Could not fetch content from: ${url}`) });
        }

        // --- SAFETY NET 2: FALLBACK DATA EXTRACTION ---
        let structuredCitations = [];
        try {
            const extractionPrompt = `
                You are a data extraction expert. Your task is to extract citation information from the provided webpage data.
                RULES:
                1.  **NEW TITLE RULE:** If a usable title is found, use it. If the 'title' field is null or empty, you MUST use the source's 'url' as the title and append the string ' (NO TITLE)' to it. NEVER discard a source.
                2.  **LENIENT AUTHOR RULE:** If a specific person's name is not found for 'author', you MUST use the 'site_name' as a fallback. If 'site_name' is also missing, use the website's domain name.
                3.  The 'year' should be extracted from the 'published_date' field or the text. If no year is found, use "n.d.".
                4.  Return ONLY a valid JSON array of objects. Each object must have these exact keys: "author", "title", "year", "url".
                Webpage Data: ${JSON.stringify(fetchedContents, null, 2)}
            `;
            const extractionPayload = { contents: [{ role: 'user', parts: [{ text: extractionPrompt }] }], generationConfig: { responseMimeType: "application/json" } };
            const extractionData = await callGeminiApi(extractionPayload, geminiApiKey);
            structuredCitations = JSON.parse(extractionData.candidates[0].content.parts[0].text);
        } catch (error) {
            console.warn("AI data extraction failed. Using manual fallback.", error);
            // Manually build the citation list if AI fails. This is Plan B.
            structuredCitations = fetchedContents.map(item => ({
                author: item.author || item.site_name || new URL(item.url).hostname,
                title: item.title || `${item.url} (NO TITLE)`,
                year: new Date(item.published_date).getFullYear() || "n.d.",
                url: item.url
            }));
        }

        // --- SAFETY NET 3: FALLBACK FORMATTING ---
        let finalCitations = [];
        try {
            const formattingPrompt = `
                You are an expert academic librarian. Format the provided JSON data into a bibliography.
                RULES:
                1.  Format ALL citations in **${citationStyle.toUpperCase()}** style.
                2.  Order the final citations **alphabetically** by author.
                3.  Return citations for as many sources as possible, up to a maximum of ${citationCount}.
                4.  Return ONLY a valid JSON array of strings.
                Source Data: ${JSON.stringify(structuredCitations, null, 2)}
            `;
            const formattingPayload = { contents: [{ role: 'user', parts: [{ text: formattingPrompt }] }], generationConfig: { responseMimeType: "application/json" } };
            const bibliographyData = await callGeminiApi(formattingPayload, geminiApiKey);
            finalCitations = JSON.parse(bibliographyData.candidates[0].content.parts[0].text);
        } catch (error) {
            console.warn("AI formatting failed. Using manual fallback.", error);
            // Manually format the list if AI fails. This is Plan C.
            finalCitations = structuredCitations.map(c => `${c.author} (${c.year}). ${c.title}. Retrieved from ${c.url}`);
        }

        // --- SAFETY NET 4: THE ULTIMATE FALLBACK ---
        if (finalCitations.length === 0) {
             console.warn("All steps failed. Returning raw URLs as last resort.");
             finalCitations = searchResults;
        }

        // --- Final Output ---
        if (outputType === 'bibliography') {
            return res.status(200).json({ citations: finalCitations });
        }

        if (outputType === 'in-text') {
            // In-text is complex, so we'll only try it if the main formatting was successful.
            // If not, we'll just return the bibliography to avoid further errors.
            try {
                const inTextPrompt = `
                    You are an expert academic editor. Insert in-text citations into the following essay.
                    RULES:
                    1.  Insert citations for **EVERY** source in the bibliography where relevant.
                    2.  Citations MUST be in the correct **${citationStyle.toUpperCase()}** format.
                    3.  **CRITICAL:** You must NOT change or rephrase the original essay text in any other way.
                    Bibliography: ${JSON.stringify(finalCitations, null, 2)}
                    Original Essay: "${essayText}"
                `;
                const inTextPayload = { contents: [{ role: 'user', parts: [{ text: inTextPrompt }] }] };
                const inTextData = await callGeminiApi(inTextPayload, geminiApiKey);
                const inTextCitedEssay = inTextData.candidates[0].content.parts[0].text;
                return res.status(200).json({ citations: finalCitations, inTextCitedEssay });
            } catch (error) {
                 console.warn("In-text generation failed. Returning bibliography only.", error);
                 return res.status(200).json({ citations: finalCitations });
            }
        }

    } catch (error) {
        console.error('A critical error occurred in the serverless function:', error);
        res.status(500).json({ error: 'An unexpected server error occurred.', details: error.message });
    }
};
