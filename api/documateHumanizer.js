// api/documateHumanizer.js
export default async function handler(req, res) {
  // --- CORS HEADERS ---
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { text, tone, personal, apiKey } = req.body;

    // 1. SELECT KEY: User Provided > Server Environment Variable
    const activeKey = (apiKey && apiKey.length > 20) ? apiKey : process.env.DOCUMATE_HUMANIZER_1;

    if (!activeKey) {
      return res.status(500).json({ error: "Configuration Error: No Groq API Key found." });
    }

    // 2. CONSTRUCT PROMPT
    const systemPrompt = `You are a text humanizer. Rewrite the following text to sound natural, undetectable by AI detectors, and fluent. 
    Tone: ${tone || 'Professional'}. 
    Perspective: ${personal ? 'First Person (I/We)' : 'Third Person/Objective'}.
    Keep the meaning exactly the same. Do not add conversational filler unless the tone is Casual.`;

    // 3. CALL GROQ
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${activeKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: text }
        ],
        model: "llama3-70b-8192",
        temperature: 0.7
      })
    });

    const data = await response.json();

    if (data.error) {
      return res.status(500).json({ error: `Groq Error: ${data.error.message}` });
    }

    // 4. RETURN TEXT
    return res.status(200).json({ text: data.choices[0].message.content });

  } catch (error) {
    return res.status(500).json({ error: `Server Error: ${error.message}` });
  }
}
