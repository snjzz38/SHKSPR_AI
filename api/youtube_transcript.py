from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from youtube_transcript_api import YouTubeTranscriptApi
import json

class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        query_components = parse_qs(urlparse(self.path).query)
        video_id = query_components.get('video_id', [None])[0]

        if not video_id:
            self.send_response(400)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': 'video_id parameter is required'}).encode('utf-8'))
            return

        try:
            # --- STRATEGY CHANGE: REMOVED ALL PROXY LOGIC ---
            # We are now making a direct request from the server.
            # This is much faster and more reliable than using free proxies.
            print(f"Fetching transcript for video_id: {video_id} directly (no proxy).")

            # The library's get_transcript method is the simplest way to do this.
            transcript_list = YouTubeTranscriptApi.get_transcript(video_id)

            if not transcript_list:
                raise Exception("Failed to retrieve transcript. The video may not have one or it might be disabled.")

            # Process and Return the Transcript
            # Note: get_transcript returns a list of dictionaries, so ['text'] is correct here.
            full_transcript = " ".join([segment['text'] for segment in transcript_list])

            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'transcript': full_transcript}).encode('utf-8'))

        except Exception as e:
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            # Provide a more helpful error message for the most common failure case
            error_message = str(e)
            if 'No transcript found' in error_message:
                error_message = "No transcript found for this video. It might be disabled or in a language that is not supported."
            
            self.wfile.write(json.dumps({'error': f'An error occurred: {error_message}'}).encode('utf-8'))
            
        return
