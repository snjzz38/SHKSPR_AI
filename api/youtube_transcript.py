from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.proxies import GenericProxyConfig
import json
import requests
import random

# The API URL from your screenshot to get a list of SOCKS4 proxies
PROXY_API_URL = "https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&proxy_format=protocolipport&format=text&protocol=socks4"

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

        transcript_list = None
        last_error = None

        try:
            # Fetch a fresh list of proxies
            proxy_response = requests.get(PROXY_API_URL, timeout=10)
            proxy_response.raise_for_status()
            proxies = proxy_response.text.strip().split('\n')
            random.shuffle(proxies) # Shuffle to try different proxies each time

            # Try proxies one by one
            for proxy_str in proxies[:10]: # Try up to 10 proxies from the list
                try:
                    # The format from the API is like "socks4://1.2.3.4:5678"
                    proxy_url = proxy_str.strip()
                    
                    print(f"Attempting to use proxy: {proxy_url}")

                    proxy_config = GenericProxyConfig(
                        http_url=proxy_url,
                        https_url=proxy_url,
                    )

                    api = YouTubeTranscriptApi(proxy_config=proxy_config)
                    transcript_list = api.fetch(video_id)
                    
                    # If we get here, the transcript was fetched successfully
                    print("Proxy successful!")
                    break # Exit the loop since we succeeded

                except Exception as e:
                    last_error = str(e)
                    print(f"Proxy {proxy_url} failed: {last_error}")
                    continue # Try the next proxy

            if not transcript_list:
                raise Exception(f"All proxies failed. Last error: {last_error}" if last_error else "No proxies found or all failed.")

            full_transcript = " ".join([item['text'] for item in transcript_list])

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
