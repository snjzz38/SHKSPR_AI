// api/documateGrader.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // 1. Extract 'model' from request
    const { parts, apiKey, model } = req.body;
    
    const activeKey = (apiKey && apiKey.length > 20) ? apiKey : process.env.DOCUMATE_GEMINI_1;
    
    // Default fallback if no model sent, though client should handle this
    const targetModel = model || 'gemma-3-27b-it'; 

    if (!activeKey) return res.status(500).json({ error: "Missing Gemini API Key." });

    // 2. Use Dynamic Model in URL
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${activeKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: parts }] })
    });

    const data = await response.json();

    if (data.error) {
      // Pass the specific model error back so client knows to rotate
      throw new Error(`[${targetModel}] ${data.error.message}`);
    }
    
    return res.status(200).json({ text: data.candidates[0].content.parts[0].text });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
