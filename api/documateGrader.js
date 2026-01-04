export default async function handler(req, res) {
  // 1. Headers for Streaming and CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { parts, apiKey, model } = req.body;
    
    if (!model) return res.status(400).end("Error: Model ID is required.");

    // Prioritize user's key, fallback to serverless secret
    const activeKey = (apiKey && apiKey.trim().length > 20) ? apiKey : process.env.DOCUMATE_GEMINI_1;
    if (!activeKey) return res.status(500).end("Error: Missing Gemini API Key.");

    // --- SCHEMA GUARD: Ensures 'parts' is an array of objects ---
    // Google returns a 500 if you send a string or a flat array.
    const formattedParts = Array.isArray(parts) 
      ? parts.map(p => typeof p === 'string' ? { text: p } : p)
      : [{ text: String(parts) }];

    const payload = {
      contents: [{ 
        role: "user", 
        parts: formattedParts 
      }]
      // Note: Search tools removed as requested to avoid quota/billing 500s
    };

    const url = `generativelanguage.googleapis.com{model}:streamGenerateContent?key=${activeKey}&alt=sse`;

    const geminiResponse = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      let errorMessage = `Status ${geminiResponse.status}`;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error?.message || errorMessage;
      } catch (e) {}
      
      // LOG THE ERROR TO VERCEL DASHBOARD for easy debugging
      console.error(`[Google API Error] ${model}:`, errorText);
      
      return res.status(geminiResponse.status).end(`Error: [${model}] ${errorMessage}`);
    }

    const reader = geminiResponse.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let leftover = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = (leftover + chunk).split('\n');
      leftover = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        
        try {
          const data = JSON.parse(trimmed.substring(6));
          // Correct mapping for Gemini 2.0+ candidates
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (text) res.write(text);
        } catch (e) {
          // Skip malformed JSON or keep-alive pings
        }
      }
    }
    res.end();

  } catch (error) {
    console.error("Critical Backend Error:", error);
    if (!res.writableEnded) res.status(500).end(`Internal Server Error: ${error.message}`);
  }
}
