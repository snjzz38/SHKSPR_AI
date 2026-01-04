export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // 1. Get the query AND the optional custom apiKey from the frontend request
    const { query, apiKey: userProvidedKey } = req.body;
    
    // 2. Determine which key to use: User's custom key OR the Serverless fallback
    const SEARCH_KEY = userProvidedKey || process.env.DOCUMATE_SEARCH_1;
    const CX = process.env.DOCUMATE_SEARCHID_1;

    if (!SEARCH_KEY || !CX) {
      return res.status(500).json({ error: "Search Configuration Missing (Check Key/CX)." });
    }

    // 3. Execute the fetch using the selected key
    const response = await fetch(
      `https://www.googleapis.com/customsearch/v1?key=${SEARCH_KEY}&cx=${CX}&q=${encodeURIComponent(query)}&num=10`
    );
    
    const data = await response.json();

    if (data.error) {
      // If the user's custom key is invalid or lacks the "Custom Search API" permission, 
      // Google will return an error here.
      throw new Error(data.error.message);
    }

    if (!data.items) return res.status(200).json({ results: "" });

    const formattedResults = data.items.map((item, i) => 
      `ID: ${i+1}\nTITLE: ${item.title}\nURL: ${item.link}\nSNIPPET: ${item.snippet}`
    ).join('\n\n---\n\n');

    return res.status(200).json({ results: formattedResults });

  } catch (error) {
    console.error("Search API Error:", error.message);
    return res.status(500).json({ error: `Search Error: ${error.message}` });
  }
}
