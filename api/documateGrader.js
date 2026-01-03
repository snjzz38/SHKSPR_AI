export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8'); // Changed to text/plain for raw streaming

  if (req.method === 'OPTIONS') return res.status(200).end();

  let geminiResponse;
  try {
    const { parts, apiKey, model } = req.body;
    if (!model) {
      res.status(400).end("Error: Model ID is required.");
      return;
    }

    const activeKey = (apiKey && apiKey.length > 20) ? apiKey : process.env.DOCUMATE_GEMINI_1;
    if (!activeKey) {
      res.status(500).end("Error: Missing Gemini API Key.");
      return;
    }

    geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${activeKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: parts }] })
    });

    if (!geminiResponse.ok) {
      const errorData = await geminiResponse.json();
      res.status(geminiResponse.status).end(`Error: [${model}] ${errorData.error?.message || geminiResponse.statusText}`);
      return;
    }

    const reader = geminiResponse.body.getReader();
    const decoder = new TextDecoder('utf-8');
    
    // Send each chunk from Gemini directly to the client
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (!line.trim()) continue;
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.substring(6));
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            if (text) {
              res.write(text); // Write raw text to client
            }
          } catch (parseError) {
            console.error("Error parsing Gemini stream chunk:", parseError, line);
            // Don't terminate client stream, just log server-side
          }
        }
      }
    }
    res.end(); // End the client's response stream

  } catch (error) {
    console.error("Serverless Grader Error:", error);
    // Ensure response is ended even on unexpected errors
    if (!res.writableEnded) {
        res.status(500).end(`Error: ${error.message}`);
    }
  }
}
