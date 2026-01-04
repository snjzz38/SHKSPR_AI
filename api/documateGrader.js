export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { parts, apiKey, model } = req.body;
    
    if (!model) return res.status(400).end("Error: Model ID is required.");

    // Prioritize User Key, fallback to serverless secret
    const activeKey = (apiKey && apiKey.length > 20) ? apiKey : process.env.DOCUMATE_GEMINI_1;
    if (!activeKey) return res.status(500).end("Error: Missing Gemini API Key.");

    // URL fixed with backticks and forward slashes to prevent "Failed to parse URL"
    const url = `generativelanguage.googleapis.com{model}:streamGenerateContent?key=${activeKey}&alt=sse`;

    const geminiResponse = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: parts }] })
    });

    if (!geminiResponse.ok) {
      const errorData = await geminiResponse.json();
      return res.status(geminiResponse.status).end(`Error: [${model}] ${errorData.error?.message || geminiResponse.statusText}`);
    }

    const reader = geminiResponse.body.getReader();
    const decoder = new TextDecoder('utf-8');
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.substring(6));
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            if (text) res.write(text);
          } catch (e) {
            // Ignore parse errors for keep-alive messages
          }
        }
      }
    }
    res.end();

  } catch (error) {
    console.error("Grader Error:", error);
    if (!res.writableEnded) res.status(500).end(`Error: ${error.message}`);
  }
}
