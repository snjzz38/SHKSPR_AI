from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.proxies import GenericProxyConfig
import json
import os
import random

# --- FINAL STRATEGY: Hardcode the user's 10 free Webshare proxies ---
# This bypasses the Webshare API, which appears to be restricted on the free plan.
WEBSHARE_PROXY_IPS = [
    "142.111.48.253:7030",
    "31.59.20.176:6754",
    "23.95.150.145:6114",
    "198.23.239.134:6540",
    "45.38.107.97:6014",
    "107.172.163.27:6543",
    "64.137.96.74:6641",
    "216.10.27.159:6837",
    "142.111.67.146:5611",
    "142.147.128.93:6593"
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
            # --- 1. Securely get Webshare credentials from Environment Variables ---
            webshare_username = os.environ.get('WEBSHARE_USERNAME')
            webshare_password = os.environ.get('WEBSHARE_PASSWORD')

            if not webshare_username or not webshare_password:
                raise Exception("Webshare credentials are not configured on the server.")

            # --- 2. Manually construct the fully authenticated proxy URLs from the hardcoded list ---
            authenticated_proxies = []
            for ip_port in WEBSHARE_PROXY_IPS:
                # Standard format: http://user:pass@host:port
                url = f"http://{webshare_username}:{webshare_password}@{ip_port}"
                authenticated_proxies.append(url)
            
            print(f"Constructed {len(authenticated_proxies)} personal proxies. Shuffling and testing...")
            random.shuffle(authenticated_proxies)

            # --- 3. Try each manually authenticated proxy ---
            transcript_data = None
            for i, proxy_url in enumerate(authenticated_proxies):
                print(f"Attempting proxy {i+1}/{len(authenticated_proxies)}")
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
                raise Exception("All 10 personal Webshare proxies failed. Please check their status in the Webshare dashboard or ensure your credentials are correct.")

            # --- 4. Process and Return the Transcript ---
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
