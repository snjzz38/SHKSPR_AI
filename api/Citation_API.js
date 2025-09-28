const fetch = require('node-fetch');

// This function cleans basic HTML from a webpage body
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

module.exports = async (req, res) => {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    // Get API keys from environment variables for security
    const SEARCH_API_KEY = process.env.SEARCH_1;
    const SEARCH_ENGINE_ID = "e5f6f17d0ff2a4ac3"; // Your Search Engine ID

    if (!SEARCH_API_KEY || !SEARCH_ENGINE_ID) {
        return res.status(500).json({ error: 'Server configuration error: Search API keys are missing.' });
    }

    const { action, query, url } = req.body;

    try {
        switch (action) {
            case 'search':
                if (!query) return res.status(400).json({ error: 'Missing required field: query.' });
                const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${SEARCH_API_KEY}&cx=${SEARCH_ENGINE_ID}&q=${encodeURIComponent(query)}&num=10`;
                const searchResponse = await fetch(searchUrl);
                const searchData = await searchResponse.json();
                const urls = searchData.items ? searchData.items.map(item => item.link) : [];
                return res.status(200).json({ urls });

            case 'fetch':
                if (!url) return res.status(400).json({ error: 'Missing required field: url.' });
                const fetchResponse = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 5000 });
                if (!fetchResponse.ok) return res.status(200).json(null); // Return null on failure so Promise.all continues
                const html = await fetchResponse.text();
                const cleanedContent = cleanHtml(html);
                return res.status(200).json({ ...cleanedContent, url });

            default:
                return res.status(400).json({ error: 'Invalid action specified.' });
        }
    } catch (error) {
        console.error(`Error in proxy action '${action}':`, error);
        res.status(500).json({ error: `Failed to perform action: ${action}.`, details: error.message });
    }
};
