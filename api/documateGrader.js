export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // 1. Get model from client
    const { parts, apiKey, model } = req.body;
    
    // 2. Validate
    if (!model) return res.status(400).json({ error: "Model ID is required." });

    const activeKey = (apiKey && apiKey.length > 20) ? apiKey : process.env.DOCUMATE_GEMINI_1;
    if (!activeKey) return res.status(500).json({ error: "Missing Gemini API Key." });

    // 3. Call specific model
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${activeKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: parts }] })
    });

    const data = await response.json();

    if (data.error) {
      // Return specific error to allow client-side rotation
      throw new Error(`[${model}] ${data.error.message}`);
    }
    
    return res.status(200).json({ text: data.candidates[0].content.parts[0].text });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
