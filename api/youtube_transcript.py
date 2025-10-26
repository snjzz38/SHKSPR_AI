from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.proxies import GenericProxyConfig
import json
import requests
import random

# Fetch a smaller, more manageable number of proxies to avoid Vercel's 10-second timeout.
GEONODE_API_URL = "https://proxylist.geonode.com/api/proxy-list?limit=30&page=1&sort_by=lastChecked&sort_type=desc"

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
            # 1. Fetch and Filter Proxies
            print(f"Fetching proxy list from Geonode API...")
            response = requests.get(GEONODE_API_URL, timeout=10)
            response.raise_for_status()
            
            api_data = response.json()
            proxy_list_raw = api_data.get('data', [])
            
            if not proxy_list_raw:
                raise Exception("API did not return any proxies.")

            socks_proxies = []
            for proxy_data in proxy_list_raw:
                protocols = proxy_data.get('protocols', [])
                ip = proxy_data.get('ip')
                port = proxy_data.get('port')

                proxy_protocol = None
                if 'socks5' in protocols:
                    proxy_protocol = 'socks5'
                elif 'socks4' in protocols:
                    proxy_protocol = 'socks4'

                if proxy_protocol and ip and port:
                    formatted_proxy = f"{proxy_protocol}://{ip}:{port}"
                    socks_proxies.append(formatted_proxy)
            
            if not socks_proxies:
                raise Exception("No SOCKS4/SOCKS5 proxies found in the API response.")

            print(f"Found {len(socks_proxies)} SOCKS proxies. Shuffling and testing...")
            random.shuffle(socks_proxies)

            # 2. Try Each Proxy Until One Succeeds
            transcript_data = None
            last_error = None

            for i, proxy_url in enumerate(socks_proxies):
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
                raise Exception(f"All {len(socks_proxies)} proxies failed. The video may not have a transcript or the proxies may be blocked.")

            # 3. Process and Return the Transcript
            # CORRECTED LINE: Use .text attribute access instead of ['text']
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
