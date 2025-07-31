// Summarizer_API.js

const express = require('express');
const app = express();
const cors = require('cors');
const YouTubeTranscriptApi = require('youtube-transcript-api');
const { TextFormatter } = require('youtube-transcript-api/formatters');

app.use(cors());
app.use(express.json());

// Extract YouTube video ID from URL
function extractVideoId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return match && match[2].length === 11 ? match[2] : null;
}

// Fetch transcript from YouTube
async function fetchYouTubeTranscript(videoId) {
    try {
        const transcriptList = await YouTubeTranscriptApi.getTranscript(videoId);
        const formatter = new TextFormatter();
        return formatter.format_transcript(transcriptList);
    } catch (error) {
        throw new Error(`Failed to fetch transcript: ${error.message}`);
    }
}

// Route to handle transcript extraction and summarization
app.post('/extract-transcript', async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    const videoId = extractVideoId(url);

    if (!videoId) {
        return res.status(400).json({ error: 'Invalid YouTube URL format' });
    }

    try {
        const transcript = await fetchYouTubeTranscript(videoId);
        res.json({ transcript });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
