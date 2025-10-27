from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.proxies import GenericProxyConfig
import json
import os
import random

# Your new Oxylabs datacenter proxy entry points
OXYLABS_HOST = "dc.oxylabs.io"
OXYLABS_PORTS = ["8001", "8002", "8003", "8004", "8005"]

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
            # 1. Securely get your new Oxylabs credentials from Environment Variables
            oxylabs_username = os.environ.get('OXYLABS_USERNAME')
            oxylabs_password = os.environ.get('OXYLABS_PASSWORD')

            if not oxylabs_username or not oxylabs_password:
                raise Exception("Oxylabs credentials are not configured on the server. Please set OXYLABS_USERNAME and OXYLABS_PASSWORD environment variables.")

            # 2. Construct the specific, authenticated Oxylabs proxy URLs
            authenticated_proxies = []
            for port in OXYLABS_PORTS:
                # This format is based on the example you provided:
                # http://user-USERNAME-country-us:PASSWORD@HOST:PORT
                # We are using 'us' for United States as a high-quality default.
                url = f"http://user-{oxylabs_username}-country-us:{oxylabs_password}@{OXYLABS_HOST}:{port}"
                authenticated_proxies.append(url)
            
            print(f"Constructed {len(authenticated_proxies)} Oxylabs proxies. Shuffling and testing...")
            random.shuffle(authenticated_proxies)

            # 3. Try each authenticated Oxylabs proxy
            transcript_data = None
            for i, proxy_url in enumerate(authenticated_proxies):
                print(f"Attempting Oxylabs proxy {i+1}/{len(authenticated_proxies)}")
                try:
                    proxy_config = GenericProxyConfig(http_url=proxy_url, https_url=proxy_url)
                    api = YouTubeTranscriptApi(proxy_config=proxy_config)
                    transcript_list = api.fetch(video_id)
                    
                    transcript_data = transcript_list
                    print(f"Proxy successful!")
                    break
                except Exception as e:
                    print(f"Proxy attempt failed: {e}")
                    continue

            if not transcript_data:
                raise Exception("All 5 Oxylabs datacenter proxies failed. Please double-check your credentials and ensure your Oxylabs plan is active.")

            # 4. Process and Return the Transcript
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
