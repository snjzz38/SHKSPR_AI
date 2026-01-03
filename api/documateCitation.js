// api/documateCitation.js
export default async function handler(req, res) {
  // --- CORS HEADERS ---
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { query } = req.body;

    // 1. LOAD SERVER KEYS (Search keys are Server-Only to prevent billing abuse)
    const SEARCH_KEY = process.env.DOCUMATE_SEARCH_1;
    const CX = process.env.DOCUMATE_SEARCHID_1;

    if (!SEARCH_KEY || !CX) {
      return res.status(500).json({ error: "Configuration Error: Search keys missing on server." });
    }

    if (!query) return res.status(400).json({ error: "Query is required." });

    // 2. CALL GOOGLE CUSTOM SEARCH
    const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${SEARCH_KEY}&cx=${CX}&q=${encodeURIComponent(query)}&num=10`;
    
    const response = await fetch(searchUrl);
    const data = await response.json();

    if (data.error) {
      return res.status(500).json({ error: `Google Search Error: ${data.error.message}` });
    }

    if (!data.items || data.items.length === 0) {
      return res.status(200).json({ results: [] }); // Return empty array, not error
    }

    // 3. FORMAT RESULTS
    // We strip unnecessary data to save bandwidth
    const formattedResults = data.items.map((item, i) => 
      `ID: ${i+1}\nTITLE: ${item.title}\nURL: ${item.link}\nSNIPPET: ${item.snippet}`
    ).join('\n\n---\n\n');

    return res.status(200).json({ results: formattedResults });

  } catch (error) {
    return res.status(500).json({ error: `Server Error: ${error.message}` });
  }
}
