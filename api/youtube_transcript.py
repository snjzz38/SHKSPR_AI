from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.proxies import GenericProxyConfig
import json
import random

# --- Your Curated "Platinum List" of Proxies Proven to Work with YouTube ---
PLATINUM_PROXY_LIST = [
    "77.246.100.210:8080",
    "160.25.8.26:11011",
    "118.70.151.55:1080",
    "223.25.109.114:8199",
    "43.133.37.149:1080",
    "220.247.166.135:8008",
    "160.25.8.162:11011",
    "202.136.88.210:11011",
    "43.131.9.114:1777",
    "115.127.107.106:1080",
    "38.183.144.18:1080",
    "46.10.229.243:7777",
    "103.118.175.165:8199"
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

        try:
            if not PLATINUM_PROXY_LIST:
                raise Exception("The proxy list is empty.")

            # Format the proxy list for SOCKS5 connection
            formatted_proxies = [f"socks5://{proxy}" for proxy in PLATINUM_PROXY_LIST]
            
            print(f"Using a curated list of {len(formatted_proxies)} platinum proxies. Shuffling and testing...")
            random.shuffle(formatted_proxies)

            # Try each proxy from the curated list until one succeeds
            transcript_data = None
            for i, proxy_url in enumerate(formatted_proxies):
                print(f"Attempting proxy {i+1}/{len(formatted_proxies)} from the platinum list.")
                try:
                    proxy_config = GenericProxyConfig(http_url=proxy_url, https_url=proxy_url)
                    api = YouTubeTranscriptApi(proxy_config=proxy_config)
                    transcript_list = api.fetch(video_id)
                    
                    transcript_data = transcript_list
                    print(f"Proxy successful!")
                    break
                except Exception as e:
                    print(f"Platinum proxy failed. Trying next...")
                    continue

            if not transcript_data:
                raise Exception("All proxies in your platinum list failed. They may have gone offline since testing. It may be necessary to generate a new list.")

            # Process and Return the Transcript
            full_transcript = " ".join([segment.text for segment in transcript_data])

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
