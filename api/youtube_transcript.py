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
            # --- The Final Fix for this Proxy ---
            # Changing the protocol from https to http as the error message suggested.
            proxy_url = "http://51.79.99.237:4502"
            
            print(f"Attempting to use single experimental proxy with HTTP: {proxy_url}")

            # Configure the proxy for both http and https traffic
            proxy_config = GenericProxyConfig(
                http_url=proxy_url,
                https_url=proxy_url
            )
            
            api = YouTubeTranscriptApi(proxy_config=proxy_config)
            
            transcript_data = api.fetch(video_id)
            
            print("Proxy successful!")

            full_transcript = " ".join([segment['text'] for segment in transcript_data])

            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'transcript': full_transcript}).encode('utf-8'))

        except Exception as e:
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': f'An error occurred with the experimental proxy: {str(e)}'}).encode('utf-8'))
            
        return
