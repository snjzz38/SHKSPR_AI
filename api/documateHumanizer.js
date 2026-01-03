export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { messages, apiKey, model } = req.body;

    if (!model) return res.status(400).end("Error: Model ID is required.");

    const activeKey = (apiKey && apiKey.length > 20) ? apiKey : process.env.DOCUMATE_HUMANIZER_1;
    if (!activeKey) return res.status(500).end("Error: Missing Groq API Key.");

    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${activeKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messages: messages,
        model: model,
        stream: true
      })
    });

    if (!groqResponse.ok) {
      const errorData = await groqResponse.json();
      return res.status(groqResponse.status).end(`Error: [${model}] ${errorData.error?.message || groqResponse.statusText}`);
    }

    const reader = groqResponse.body.getReader();
    const decoder = new TextDecoder('utf-8');
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          if (line.includes('[DONE]')) continue;
          try {
            const data = JSON.parse(line.substring(6));
            const text = data.choices?.[0]?.delta?.content || '';
            if (text) res.write(text);
          } catch (e) {}
        }
      }
    }
    res.end();

  } catch (error) {
    if (!res.writableEnded) res.status(500).end(`Error: ${error.message}`);
  }
}
