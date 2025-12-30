// File: api/agentAPI.js

export const config = {
  runtime: 'edge', // Edge runtime is required for efficient streaming
};

export default async function handler(req) {
  // 1. Handle CORS preflight (OPTIONS request)
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  // 2. Only allow POST requests
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await req.json();
    const { model, contents, customKey } = body;

    // 3. Determine API Key (Prioritize User Custom Key, fallback to Server Env)
    const apiKey = customKey || process.env.AGENT_1;

    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Server Configuration Error: API Key missing." }), {
        status: 500,
        headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // 4. Construct Gemini API URL (Stream enabled)
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`;

    // 5. Proxy request to Google
    const upstreamResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents })
    });

    if (!upstreamResponse.ok) {
      const errorText = await upstreamResponse.text();
      return new Response(JSON.stringify({ error: `Gemini API Error: ${upstreamResponse.status}`, details: errorText }), {
        status: upstreamResponse.status,
        headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // 6. Pipe the stream back to the extension
    return new Response(upstreamResponse.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*', // Critical for Chrome Extensions
      },
    });

  } catch (error) {
    console.error("Agent API Error:", error);
    return new Response(JSON.stringify({ error: error.message || 'Internal Server Error' }), {
      status: 500,
      headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
      }
    });
  }
}
