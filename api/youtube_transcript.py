from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from youtube_transcript_api import YouTubeTranscriptApi
import json

class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        # Parse query parameters
        query_components = parse_qs(urlparse(self.path).query)
        video_id = query_components.get('video_id', [None])[0]

        if not video_id:
            self.send_response(400)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': 'video_id parameter is required'}).encode('utf-8'))
            return

        try:
            # CORRECTED SECTION: Instantiate the class and call fetch()
            # This was the line with the error.
            # OLD: transcript_list = YouTubeTranscriptApi.get_transcript(video_id)
            # NEW:
            api = YouTubeTranscriptApi()
            transcript_list = api.fetch(video_id)
            
            # Combine the transcript text into a single string
            full_transcript = " ".join([item['text'] for item in transcript_list])

            # Send a successful response
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'transcript': full_transcript}).encode('utf-8'))

        except Exception as e:
            # Handle errors (e.g., video not found, no transcript)
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': f'An error occurred: {str(e)}'}).encode('utf-8'))
            
        return
