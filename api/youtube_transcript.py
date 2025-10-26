from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from youtube_transcript_api import YouTubeTranscriptApi
import json
import requests # We need this to fetch the proxy list
import random

# The API URL for fetching a list of fresh proxies from Geonode
# This URL fetches 500 proxies, sorted by the last time they were checked
GEONODE_API_URL = "https://proxylist.geonode.com/api/proxy-list?limit=500&page=1&sort_by=lastChecked&sort_type=desc"

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
            # --- 1. Fetch Proxies Dynamically from the API ---
            print(f"Fetching proxy list from Geonode API...")
            response = requests.get(GEONODE_API_URL, timeout=10) # 10-second timeout
            response.raise_for_status() # Raise an exception for bad status codes (like 404, 500)
            
            api_data = response.json()
            proxy_list_raw = api_data.get('data', [])
            
            if not proxy_list_raw:
                raise Exception("API did not return any proxies.")

            # --- 2. Filter for SOCKS4/SOCKS5 Proxies and Format Them ---
            socks_proxies = []
            for proxy_data in proxy_list_raw:
                # We only care about proxies that support socks4 or socks5
                protocols = proxy_data.get('protocols', [])
                ip = proxy_data.get('ip')
                port = proxy_data.get('port')

                # Find the first SOCKS protocol in the list for that proxy
                proxy_protocol = None
                if 'socks5' in protocols:
                    proxy_protocol = 'socks5'
                elif 'socks4' in protocols:
                    proxy_protocol = 'socks4'

                if proxy_protocol and ip and port:
                    # Format for the requests library: "protocol://ip:port"
                    formatted_proxy = f"{proxy_protocol}://{ip}:{port}"
                    socks_proxies.append(formatted_proxy)
            
            if not socks_proxies:
                raise Exception("No SOCKS4/SOCKS5 proxies found in the API response.")

            print(f"Found {len(socks_proxies)} SOCKS proxies. Shuffling and testing...")
            random.shuffle(socks_proxies)

            # --- 3. Try Each Proxy Until One Succeeds ---
            transcript_data = None
            last_error = None

            for i, proxy_url in enumerate(socks_proxies):
                print(f"Attempting proxy {i+1}/{len(socks_proxies)}: {proxy_url}")
                try:
                    # The youtube_transcript_api uses the 'requests' library, which
                    # expects the proxy in a dictionary format.
                    proxies_dict = {
                        'http': proxy_url,
                        'https': proxy_url
                    }
                    
                    # Fetch the transcript using the current proxy
                    transcript_list = YouTubeTranscriptApi.get_transcript(video_id, proxies=proxies_dict)
                    
                    # If we get here, the proxy worked!
                    transcript_data = transcript_list
                    print(f"Proxy successful: {proxy_url}")
                    break # Exit the loop since we found a working proxy

                except Exception as e:
                    last_error = str(e)
                    print(f"Proxy {proxy_url} failed: {last_error}")
                    # Continue to the next proxy in the list
                    continue

            if not transcript_data:
                error_message = f"All {len(socks_proxies)} proxies failed."
                if last_error:
                    error_message += f" Last error: {last_error}"
                raise Exception(error_message)

            # --- 4. Process and Return the Transcript ---
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
