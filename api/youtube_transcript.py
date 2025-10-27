from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.proxies import GenericProxyConfig
import json
import os
import requests
import random

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
            # --- 1. Securely get ALL Webshare credentials from Environment Variables ---
            webshare_username = os.environ.get('WEBSHARE_USERNAME')
            webshare_password = os.environ.get('WEBSHARE_PASSWORD')
            webshare_api_key = os.environ.get('WEBSHARE_API_KEY')

            if not all([webshare_username, webshare_password, webshare_api_key]):
                raise Exception("Webshare credentials or API key are not configured on the server.")

            # --- 2. Fetch your personal proxy list from the CORRECT Webshare API URL ---
            print("Fetching personal proxy list from Webshare API...")
            #
            # --- THIS IS THE CORRECTED LINE ---
            #
            api_url = "https://proxy.webshare.io/api/v2/proxy/list/"
            headers = {"Authorization": f"Token {webshare_api_key}"}
            response = requests.get(api_url, headers=headers, timeout=10)
            response.raise_for_status()
            
            proxy_data = response.json().get('results', [])
            if not proxy_data:
                raise Exception("Webshare API did not return any proxies.")

            # --- 3. Manually construct the fully authenticated proxy URLs ---
            authenticated_proxies = []
            for proxy in proxy_data:
                ip = proxy.get('proxy_address')
                port = proxy.get('ports', {}).get('http')
                if ip and port and proxy.get('valid'):
                    url = f"http://{webshare_username}:{webshare_password}@{ip}:{port}"
                    authenticated_proxies.append(url)
            
            if not authenticated_proxies:
                raise Exception("Could not construct any valid authenticated proxy URLs.")

            print(f"Found {len(authenticated_proxies)} personal proxies. Shuffling and testing...")
            random.shuffle(authenticated_proxies)

            # --- 4. Try each manually authenticated proxy ---
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
                raise Exception("All personal Webshare proxies failed. Please check their status in the Webshare dashboard.")

            # --- 5. Process and Return the Transcript ---
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
