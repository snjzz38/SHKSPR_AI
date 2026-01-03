export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { messages, apiKey, model } = req.body;

    if (!model) return res.status(400).json({ error: "Model ID is required." });

    const activeKey = (apiKey && apiKey.length > 20) ? apiKey : process.env.DOCUMATE_HUMANIZER_1;
    if (!activeKey) return res.status(500).json({ error: "Missing Groq API Key." });

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${activeKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messages: messages,
        model: model // <--- Dynamic
      })
    });

    const data = await response.json();

    if (data.error) throw new Error(data.error.message);

    return res.status(200).json({ text: data.choices[0].message.content });

  } catch (error) {
    return res.status(500).json({ error: `Groq Error: ${error.message}` });
  }
}
