from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.proxies import GenericProxyConfig
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
            # --- Hardcoded Experimental Proxy ---
            # Using the specific HTTP proxy you found.
            proxy_url = "http://51.79.99.237:4502"
            
            print(f"Attempting to use single hardcoded proxy: {proxy_url}")

            # Configure the proxy for both http and https traffic
            proxy_config = GenericProxyConfig(
                http_url=proxy_url,
                https_url=proxy_url
            )
            
            # Create the API instance with the proxy
            api = YouTubeTranscriptApi(proxy_config=proxy_config)
            
            # Attempt to fetch the transcript
            transcript_data = api.fetch(video_id)
            
            print("Proxy and fetch successful!")

            # Correctly format the transcript text using .text
            full_transcript = " ".join([segment.text for segment in transcript_data])

            # Send the successful response
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'transcript': full_transcript}).encode('utf-8'))

        except Exception as e:
            # If anything fails, send back a specific error
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': f'The hardcoded proxy failed: {str(e)}'}).encode('utf-8'))
            
        return
