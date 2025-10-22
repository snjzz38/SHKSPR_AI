from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.proxies import GenericProxyConfig
import json
import random

# --- A manually curated list of promising proxies from free-proxy-list.net ---
# You can add more good ones you find here.
PROXY_LIST = [
    "http://31.59.20.176:6754",
    "http://142.111.48.253:7030"
    # Add another proxy here, e.g., "http://IP_ADDRESS:PORT"
    # Add a third one here...
]

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

        transcript_data = None
        last_error = None

        try:
            # Shuffle our curated list of proxies
            random.shuffle(PROXY_LIST)

            # Try every proxy in our list
            for proxy_url in PROXY_LIST:
                try:
                    clean_proxy_url = proxy_url.strip()
                    if not clean_proxy_url:
                        continue
                    
                    print(f"Attempting to use proxy: {clean_proxy_url}")

                    proxy_config = GenericProxyConfig(
                        http_url=clean_proxy_url,
                        https_url=clean_proxy_url
                    )
                    api = YouTubeTranscriptApi(proxy_config=proxy_config)
                    
                    transcript_data = api.fetch(video_id)
                    
                    print("Proxy successful!")
                    break 

                except Exception as e:
                    last_error = str(e)
                    print(f"Proxy {clean_proxy_url} failed: {last_error}")
                    continue

            if not transcript_data:
                raise Exception(f"All curated proxies failed. Last error: {last_error}" if last_error else "Proxy list is empty.")

            full_transcript = " ".join([segment.text for segment in transcript_data])

            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'transcript': full_transcript}).encode('utf-8'))

        except Exception as e:
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': f'An error occurred: {str(e)}'}).encode('utf-8'))
            
        return
