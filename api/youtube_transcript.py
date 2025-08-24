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
            # Using the experimental HTTP proxy
            proxy_url = "http://51.79.99.237:4502"
            
            print(f"Attempting to use single experimental proxy with HTTP: {proxy_url}")

            proxy_config = GenericProxyConfig(
                http_url=proxy_url,
                https_url=proxy_url
            )
            
            api = YouTubeTranscriptApi(proxy_config=proxy_config)
            
            transcript_data = api.fetch(video_id)
            
            print("Proxy and fetch successful! Formatting transcript...")

            # --- THE ACTUAL FIX IS HERE ---
            # The previous code still had segment['text']. This is now correct.
            full_transcript = " ".join([segment.text for segment in transcript_data])

            # Send the successful response
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'transcript': full_transcript}).encode('utf-8'))

        except Exception as e:
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': f'An error occurred: {str(e)}'}).encode('utf-8'))
            
        return```

I am confident this will resolve the `'FetchedTranscriptSnippet' object is not subscriptable` error. Again, my sincere apologies for the repeated mistake.
