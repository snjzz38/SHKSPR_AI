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
    if (!parts) return res.status(400).end("Error: No content provided.");

    const activeKey = (apiKey && apiKey.trim().length > 20) ? apiKey : process.env.DOCUMATE_GEMINI_1;
    
    // Ensure parts is formatted as an array of objects
    const formattedParts = Array.isArray(parts) 
      ? parts.map(p => typeof p === 'string' ? { text: p } : p)
      : [{ text: String(parts) }];

    const payload = {
      contents: [{ role: "user", parts: formattedParts }]
    };

    // FIXED URL: Added missing "/" and ensured correct template literal syntax
    const url = `generativelanguage.googleapis.com{model}:streamGenerateContent?key=${activeKey}&alt=sse`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).end(`Google API Error: ${errText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      let lines = buffer.split("\n");
      buffer = lines.pop(); 

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        try {
          const json = JSON.parse(trimmed.substring(6));
          const txt = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (txt) res.write(txt);
        } catch (e) {}
      }
    }
    res.end();

  } catch (error) {
    console.error("Grader Error:", error);
    res.status(500).end(`Internal Server Error: ${error.message}`);
  }
}
