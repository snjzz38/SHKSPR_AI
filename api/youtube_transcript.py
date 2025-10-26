from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.proxies import GenericProxyConfig
import json
import requests
import random

# NEW, SUPERIOR PROXY SOURCE: ProxyScrape
# - Filters for SOCKS4/5 protocols.
# - Filters for high-anonymity proxies.
# - Filters for proxies with a timeout of less than ~2.2 seconds (2218ms). This is the key improvement.
# - Returns a simple text list, which is fast to parse.
PROXY_API_URL = "https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&protocol=socks4,socks5&proxy_format=protocolipport&format=text&anonymity=Elite,Anonymous&timeout=2218"

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
            # 1. Fetch the pre-filtered, high-speed proxy list
            print(f"Fetching high-speed proxy list from ProxyScrape API...")
            response = requests.get(PROXY_API_URL, timeout=10)
            response.raise_for_status()
            
            # The response is plain text, with one proxy per line.
            proxy_list_text = response.text
            
            # Split the text into a list and filter out any empty lines.
            socks_proxies = [line.strip() for line in proxy_list_text.split('\n') if line.strip()]
            
            if not socks_proxies:
                raise Exception("ProxyScrape API did not return any proxies. The service may be temporarily down.")

            print(f"Found {len(socks_proxies)} high-speed SOCKS proxies. Shuffling and testing...")
            random.shuffle(socks_proxies)

            # 2. Try Each Proxy
            transcript_data = None
            last_error = None

            for i, proxy_url in enumerate(socks_proxies):
                # We only try a maximum of 30 proxies to be safe with the timeout.
                if i >= 30:
                    print("Tested 30 proxies, stopping to avoid timeout.")
                    break
                
                print(f"Attempting proxy {i+1}/{len(socks_proxies)}: {proxy_url}")
                try:
                    proxy_config = GenericProxyConfig(
                        http_url=proxy_url,
                        https_url=proxy_url
                    )
                    api = YouTubeTranscriptApi(proxy_config=proxy_config)
                    
                    transcript_list = api.fetch(video_id)
                    
                    transcript_data = transcript_list
                    print(f"Proxy successful: {proxy_url}")
                    break

                except Exception as e:
                    last_error = str(e)
                    print(f"Proxy {proxy_url} failed.")
                    continue

            if not transcript_data:
                raise Exception(f"All {len(socks_proxies)} high-speed proxies failed. The video may not have a transcript or YouTube may be temporarily blocking proxies.")

            # 3. Process and Return the Transcript
            full_transcript = " ".join([segment['text'] for segment in transcript_data])

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
