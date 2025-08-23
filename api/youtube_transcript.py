from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.proxies import GenericProxyConfig
import json
import requests
import random

# API URL to get a list of fresh, working HTTPS proxies
PROXY_API_URL = "https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&proxy_format=protocolipport&format=text&protocol=http&ssl=yes"

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
            # Fetch a fresh list of HTTPS proxies, with a 5-second timeout
            proxy_response = requests.get(PROXY_API_URL, timeout=5)
            proxy_response.raise_for_status()
            proxies = proxy_response.text.strip().split('\n')
            random.shuffle(proxies)

            # Try up to 5 proxies to find a working one quickly
            for proxy_str in proxies[:5]:
                try:
                    # Clean the raw proxy string before using it
                    clean_proxy_str = proxy_str.strip()
                    if not clean_proxy_str:
                        continue # Skip empty lines

                    proxy_url = "https://" + clean_proxy_str.split('://')[1]
                    
                    print(f"Attempting to use proxy: {proxy_url}")

                    proxy_config = GenericProxyConfig(https_url=proxy_url)
                    api = YouTubeTranscriptApi(proxy_config=proxy_config)
                    
                    transcript_data = api.fetch(video_id)
                    
                    print("Proxy successful!")
                    break 

                except Exception as e:
                    last_error = str(e)
                    # --- THIS IS THE FIX ---
                    # We use 'clean_proxy_str' here because 'proxy_url' might not have been created.
                    print(f"Proxy {clean_proxy_str} failed: {last_error}")
                    continue

            if not transcript_data:
                raise Exception(f"All proxies failed. Last error: {last_error}" if last_error else "No proxies found or all failed.")

            full_transcript = " ".join([segment['text'] for segment in transcript_data])

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
