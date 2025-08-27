// api/Citation_API.js
const fetch = require('node-fetch');

exports.default = async function handler(request, response) {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') {
        return response.status(200).end();
    }

    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method Not Allowed' });
    }

    const geminiApiKey = process.env.CITATION_1;
    const searchApiKey = process.env.SEARCH_1;
    const searchEngineId = "e5f6f17d0ff2a4ac3";

    if (!geminiApiKey || !searchApiKey) {
        return response.status(500).json({ error: 'Server configuration error: API keys are missing.' });
    }

    try {
        // --- FIX: Read the correct fields from the request body ---
        const { essayText, citationStyle, outputType } = request.body;

        if (!essayText || !citationStyle || !outputType) {
            return response.status(400).json({ error: 'Missing required fields: essayText, citationStyle, and outputType are required.' });
        }

        // --- FIX: Construct the detailed prompt on the server ---
        const prompt = `
            You are a helpful AI that generates academic citations based on provided text.
            
            Task:
            1. Analyze the following essay text to identify claims or facts that require an external source.
            2. Use the 'google_search' tool to find a reputable source (e.g., academic journal, official report, book, or major news site) that supports each claim.
            3. Based on the information found, generate a citation for each source in the requested style.
            4. If the output type is 'bibliography', list the full citations. If the output type is 'in-text', generate only the in-text citations.
            5. If no sources are found or the text doesn't contain citable information, respond with "No citable claims were found in the provided text."

            Essay Text:
            "${essayText}"

            Citation Style: ${citationStyle}
            Output Type: ${outputType}

            Ensure each citation is properly formatted according to the specified style.
        `;

        const tools = [{
            functionDeclarations: [{
                name: "google_search",
                description: "Search for information on Google to find reputable sources for claims.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        queries: {
                            type: "ARRAY",
                            description: "A list of search queries to find sources.",
                            items: { type: "STRING" }
                        }
                    },
                    required: ["queries"]
                }
            }]
        }];
        
        const initialPayload = {
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            tools: tools,
        };

        const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${geminiApiKey}`;

        let geminiResponse = await fetch(geminiApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(initialPayload)
        });
        
        let geminiResult = await geminiResponse.json();

        if (geminiResult?.candidates?.[0]?.content?.parts?.[0]?.functionCall) {
            const functionCall = geminiResult.candidates[0].content.parts[0].functionCall;

            if (functionCall.name === 'google_search') {
                const queries = functionCall.args.queries;
                if (!queries || queries.length === 0) {
                    throw new Error('Google Search tool call failed: no queries provided.');
                }
                const query = queries[0];
                
                const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${searchApiKey}&cx=${searchEngineId}&q=${encodeURIComponent(query)}`;
                const searchApiResponse = await fetch(searchUrl);
                const searchData = await searchApiResponse.json();

                if (!searchApiResponse.ok) {
                    throw new Error(searchData.error?.message || 'Google Custom Search API error');
                }

                const searchResults = searchData.items ? searchData.items.map(item => ({
                    title: item.title,
                    snippet: item.snippet,
                    url: item.link
                })) : [];
                
                const toolResponsePart = {
                    functionResponse: {
                        name: 'google_search',
                        response: { results: searchResults }
                    }
                };
                
                const finalPayload = {
                    contents: [
                        ...initialPayload.contents,
                        { role: 'model', parts: [{ functionCall }] },
                        { role: 'tool', parts: [toolResponsePart] }
                    ],
                };
                
                let finalGeminiResponse = await fetch(geminiApiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(finalPayload)
                });
                
                geminiResult = await finalGeminiResponse.json();
            }
        }

        const text = geminiResult?.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!text) {
            console.error('Full Gemini response:', JSON.stringify(geminiResult, null, 2));
            throw new Error('The AI model did not return any text.');
        }

        response.status(200).json({ citation: text });

    } catch (error) {
        console.error('Error generating citation:', error);
        response.status(500).json({ error: 'Failed to generate citation.', details: error.message });
    }
};
