from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from youtube_transcript_api import YouTubeTranscriptApi
# --- NEW: Import the specific WebshareProxyConfig class ---
from youtube_transcript_api.proxies import WebshareProxyConfig
import json
import os # --- NEW: Import the 'os' module to access environment variables ---

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
            # --- 1. Securely get Webshare credentials from Environment Variables ---
            webshare_username = os.environ.get('WEBSHARE_USERNAME')
            webshare_password = os.environ.get('WEBSHARE_PASSWORD')

            if not webshare_username or not webshare_password:
                raise Exception("Webshare credentials are not configured on the server. Please set WEBSHARE_USERNAME and WEBSHARE_PASSWORD environment variables.")

            print("Attempting to fetch transcript using Webshare authenticated proxy...")

            # --- 2. Configure the API to use your Webshare account ---
            # This is much simpler. No more loops or fetching lists.
            proxy_config = WebshareProxyConfig(
                proxy_username=webshare_username,
                proxy_password=webshare_password
            )
            
            api = YouTubeTranscriptApi(proxy_config=proxy_config)
            
            # --- 3. Fetch the transcript ---
            # The library will handle rotating through your 10 Webshare proxies automatically.
            transcript_list = api.fetch(video_id)

            if not transcript_list:
                raise Exception("Failed to retrieve transcript. The video may not have one or it might be disabled.")

            # --- 4. Process and Return the Transcript ---
            # Use .text, which we know is correct for the .fetch() method.
            full_transcript = " ".join([segment.text for segment in transcript_list])

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
            self.wfile.write(json.dumps({'error': f'An error occurred: {str(e)}'}).encode('utf-8'))
            
        return
