// api/documateGrader.js
export default async function handler(req, res) {
  // --- CORS HEADERS ---
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { parts, apiKey } = req.body;

    // 1. SELECT KEY: User Provided > Server Environment Variable
    const activeKey = (apiKey && apiKey.length > 20) ? apiKey : process.env.DOCUMATE_GEMINI_1;

    if (!activeKey) {
      return res.status(500).json({ error: "Configuration Error: No Gemini API Key found (Server or Client)." });
    }

    // 2. CALL GEMINI
    // We use gemini-2.0-flash as the default fast/smart model
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${activeKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: parts }] })
    });

    const data = await response.json();

    if (!response.ok) {
      const errorMsg = data.error?.message || response.statusText;
      return res.status(response.status).json({ error: `Gemini Error: ${errorMsg}` });
    }

    if (!data.candidates || !data.candidates[0].content) {
      return res.status(500).json({ error: "Gemini returned no content." });
    }

    // 3. RETURN TEXT
    return res.status(200).json({ text: data.candidates[0].content.parts[0].text });

  } catch (error) {
    return res.status(500).json({ error: `Server Error: ${error.message}` });
  }
}
