const fetch = require('node-fetch');

function cleanHtml(html) {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const cleanText = (bodyMatch ? bodyMatch[1] : html)
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s\s+/g, ' ')
        .trim();
    return {
        title: titleMatch ? titleMatch[1] : 'No title found',
        body_snippet: cleanText.substring(0, 3000)
    };
}

const shuffleArray = (array) => {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
};

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { action, query, url, payload, models } = req.body;

    // Get API keys from environment variables for security
    const GEMINI_API_KEY = process.env.CITATION_1;
    const SEARCH_API_KEY = process.env.SEARCH_1;
    const SEARCH_ENGINE_ID = "e5f6f17d0ff2a4ac3";

    try {
        switch (action) {
            case 'search':
                if (!SEARCH_API_KEY) return res.status(500).json({ error: 'Search API key not configured.' });
                if (!query) return res.status(400).json({ error: 'Missing query for search action.' });
                
                const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${SEARCH_API_KEY}&cx=${SEARCH_ENGINE_ID}&q=${encodeURIComponent(query)}&num=10`;
                const searchResponse = await fetch(searchUrl);
                const searchData = await searchResponse.json();
                const urls = searchData.items ? searchData.items.map(item => item.link) : [];
                return res.status(200).json({ urls });

            case 'fetch':
                if (!url) return res.status(400).json({ error: 'Missing url for fetch action.' });
                
                const fetchResponse = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 5000 });
                if (!fetchResponse.ok) return res.status(200).json(null);
                const html = await fetchResponse.text();
                const cleanedContent = cleanHtml(html);
                return res.status(200).json({ ...cleanedContent, url });

            case 'callGemini':
                if (!GEMINI_API_KEY) return res.status(500).json({ error: 'Gemini API key not configured.' });
                if (!payload || !models) return res.status(400).json({ error: 'Missing payload or models for callGemini action.' });

                let modelsToTry = shuffleArray([...models]);
                let lastError = null;
                for (const currentModel of modelsToTry) {
                    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${GEMINI_API_KEY}`;
                    try {
                        const geminiResponse = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                        if (!geminiResponse.ok) {
                            const errorData = await geminiResponse.json().catch(() => ({}));
                            throw new Error(`API call with ${currentModel} failed: ${errorData.error?.message || geminiResponse.statusText}`);
                        }
                        const result = await geminiResponse.json();
                        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
                        if (text && text.trim() !== '') return res.status(200).json(result);
                        throw new Error(`Model ${currentModel} returned an empty response.`);
                    } catch (error) {
                        console.warn(error.message);
                        lastError = error;
                    }
                }
                throw lastError || new Error("All API models failed.");

            default:
                return res.status(400).json({ error: 'Invalid action specified.' });
        }
    } catch (error) {
        console.error(`Error in proxy action '${action}':`, error);
        res.status(500).json({ error: `Failed to perform action: ${action}.`, details: error.message });
    }
};
