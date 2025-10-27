from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.proxies import GenericProxyConfig
import json
import random

# --- FOR DEBUGGING ONLY: Hardcoding credentials to bypass environment variables ---
# WARNING: DO NOT COMMIT THIS TO A PUBLIC REPOSITORY
WEBSHARE_USERNAME = "wfjcuixb"
WEBSHARE_PASSWORD = "utyyt4s7xv67l"

# Hardcoded list of the user's 10 free Webshare proxies.
WEBSHARE_PROXY_IPS = [
    "142.111.48.253:7030", "31.59.20.176:6754", "23.95.150.145:6114",
    "198.23.239.134:6540", "45.38.107.97:6014", "107.172.163.27:6543",
    "64.137.96.74:6641", "216.10.27.159:6837", "142.111.67.146:5611",
    "142.147.128.93:6593"
]

class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        query_components = parse_qs(urlparse(self.path).query)
        video_id = query_components.get('video_id', [None])[0]

        if not video_id:
            # ... (error handling)
            return

        try:
            # 1. Manually construct SOCKS5 authenticated proxy URLs from hardcoded values
            authenticated_proxies = []
            for ip_port in WEBSHARE_PROXY_IPS:
                url = f"socks5://{WEBSHARE_USERNAME}:{WEBSHARE_PASSWORD}@{ip_port}"
                authenticated_proxies.append(url)
            
            print(f"Constructed {len(authenticated_proxies)} hardcoded SOCKS5 proxies. Shuffling and testing...")
            random.shuffle(authenticated_proxies)

            # 2. Try each SOCKS5 authenticated proxy
            transcript_data = None
            for i, proxy_url in enumerate(authenticated_proxies):
                print(f"Attempting SOCKS5 proxy {i+1}/{len(authenticated_proxies)}")
                try:
                    proxy_config = GenericProxyConfig(http_url=proxy_url, https_url=proxy_url)
                    api = YouTubeTranscriptApi(proxy_config=proxy_config)
                    transcript_list = api.fetch(video_id)
                    
                    transcript_data = transcript_list
                    print(f"Proxy successful!")
                    break
                except Exception as e:
                    # We expect failures, so we keep the error message brief
                    print(f"Proxy attempt failed.")
                    continue

            if not transcript_data:
                raise Exception("All 10 hardcoded proxies failed. This suggests a network issue between Vercel and Webshare, or the proxies are blocked by YouTube.")

            # 3. Process and Return the Transcript
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
