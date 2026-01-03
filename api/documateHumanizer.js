export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8'); // Changed to text/plain for raw streaming

  if (req.method === 'OPTIONS') return res.status(200).end();

  let groqResponse;
  try {
    const { messages, apiKey, model } = req.body;

    if (!model) {
      res.status(400).end("Error: Model ID is required.");
      return;
    }

    const activeKey = (apiKey && apiKey.length > 20) ? apiKey : process.env.DOCUMATE_HUMANIZER_1;
    if (!activeKey) {
      res.status(500).end("Error: Missing Groq API Key.");
      return;
    }

    groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${activeKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messages: messages,
        model: model,
        stream: true // Enable streaming for Groq
      })
    });

    if (!groqResponse.ok) {
      const errorData = await groqResponse.json();
      res.status(groqResponse.status).end(`Error: [${model}] ${errorData.error?.message || groqResponse.statusText}`);
      return;
    }

    const reader = groqResponse.body.getReader();
    const decoder = new TextDecoder('utf-8');
    
    // Send each chunk from Groq directly to the client
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (!line.trim()) continue;
        if (line.startsWith('data: ')) {
          if (line.substring(6) === '[DONE]') continue; // Groq sends [DONE] sometimes
          try {
            const data = JSON.parse(line.substring(6));
            const text = data.choices?.[0]?.delta?.content || '';
            if (text) {
              res.write(text); // Write raw text to client
            }
          } catch (parseError) {
            console.error("Error parsing Groq stream chunk:", parseError, line);
          }
        }
      }
    }
    res.end();

  } catch (error) {
    console.error("Serverless Humanizer Error:", error);
    if (!res.writableEnded) {
        res.status(500).end(`Error: ${error.message}`);
    }
  }
}
