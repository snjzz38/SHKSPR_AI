export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Set content type for SSE (Server-Sent Events)
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');

  // Handle Preflight
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { parts, apiKey, model } = req.body;
    
    if (!model) return res.status(400).end("Error: Model ID is required.");

    // Prioritize user key, fallback to server secret
    const activeKey = (apiKey && apiKey.length > 20) ? apiKey : process.env.DOCUMATE_GEMINI_1;
    
    if (!activeKey) {
        console.error("Missing API Key");
        return res.status(500).end("Error: Missing Gemini API Key.");
    }

    // --- FIX: Changed 'v1' to 'v1beta' ---
    // Newer models (Gemma, Gemini 1.5/2.0) require the v1beta endpoint.
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${activeKey}&alt=sse`;

    const geminiResponse = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents: [{ parts: parts }],
        // Optional: Add safety settings if needed to prevent blocks
        safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
        ]
      })
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      // Pass the specific Google error back to the frontend for debugging
      return res.status(geminiResponse.status).end(`Google API Error: ${errorText}`);
    }

    // Stream the response back to the client
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
            // Ignore keep-alive or empty JSON parse errors
          }
        }
      }
    }
    res.end();

  } catch (error) {
    console.error("Gemini Proxy Error:", error);
    if (!res.writableEnded) res.status(500).end(`Error: ${error.message}`);
  }
}
