export default async function handler(req, res) {
  try {
    // Ensure the correct environment variable is used
    if (!process.env.Humanizer_1) {
      return res.status(500).json({ error: 'API key is not configured (Humanizer_1 environment variable missing)' });
    }
    if (!req.body || typeof req.body !== 'object' || !req.body.model || !req.body.messages) {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Use the Humanizer_1 environment variable for authorization
        'Authorization': `Bearer ${process.env.Humanizer_1}`,
      },
      body: JSON.stringify(req.body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return res.status(response.status).json({ error: errorBody });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error('Serverless function error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
