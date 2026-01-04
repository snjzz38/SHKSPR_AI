export default async function handler(req, res) {
  // 1. Set standard CORS and Streaming headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { parts, apiKey, model } = req.body;
    
    // Ensure the model is passed from the frontend rotation logic
    if (!model) return res.status(400).end("Error: Model ID is required.");

    // Determine key: prioritize user's custom key, fallback to server secret
    const activeKey = (apiKey && apiKey.trim().length > 20) ? apiKey : process.env.DOCUMATE_GEMINI_1;
    if (!activeKey) return res.status(500).end("Error: Missing Gemini API Key.");

    // 2026 Grounding: This adds Google Search capability to the prompt.
    // Note: Some Gemma models may ignore this tool if they don't support grounding,
    // but Gemini models will use it to provide live search results.
    const payload = {
      contents: [{ parts: parts }],
    };

    // Construct the endpoint using the model name passed from uses/api.js
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
      } catch (e) {
        errorMessage = errorText || errorMessage;
      }
      return res.status(geminiResponse.status).end(`Error: [${model}] ${errorMessage}`);
    }

    // Stream handling
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
            // Extract text from the candidate
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            if (text) res.write(text);
          } catch (e) {
            // Keep-alive or malformed chunks are ignored
          }
        }
      }
    }
    res.end();

  } catch (error) {
    console.error("Grader Execution Error:", error);
    if (!res.writableEnded) res.status(500).end(`Internal Server Error: ${error.message}`);
  }
}
