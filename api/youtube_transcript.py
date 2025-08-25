from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.proxies import GenericProxyConfig
import json
import random

# --- A manually curated list of promising proxies from free-proxy-list.net ---
# You can add more good ones you find here.
PROXY_LIST = [
    "http://51.79.99.237:4502",
    "http://43.154.134.238:50001",
    "http://124.6.51.227:8099",
    "http://72.10.164.178:28247",
    "http://195.158.8.123:3128",
    "http://203.162.13.222:6868",
    "http://85.239.144.149:8080",
    "http://147.75.34.74:10019",
    "http://157.180.121.252:46206",
    "http://47.90.205.231:33333",
    "http://78.157.57.71:3128",
    "http://85.133.240.75:8080",
    "http://176.9.238.176:16379",
    "http://91.218.244.153:8989",
    "http://79.174.12.190:80",
    "http://51.254.132.238:90",
    "http://51.161.56.52:80",
    "http://209.121.164.50:31147",
    "http://77.238.103.98:8080",
    "http://147.75.34.105:443",
    "http://72.10.160.90:3581",
    "http://67.43.236.20:6231",
    "http://94.73.239.124:55443",
    "http://8.211.49.86:9050",
    "http://31.220.78.244:80",
    "http://37.27.6.46:80",
    "http://65.108.203.37:28080",
    "http://65.108.203.35:28080",
    "http://67.43.236.19:3527",
    "http://42.96.16.176:1312",
    "http://65.108.159.129:8081",
    "http://95.53.246.137:3128",
    "http://20.13.34.208:8118",
    "http://72.10.160.170:3949",
    "http://124.6.51.226:8099",
    "http://72.10.160.173:19329",
    "http://65.108.203.36:28080",
    "http://67.43.228.250:7015"
];

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
            # Shuffle our curated list of proxies
            random.shuffle(PROXY_LIST)

            # Try every proxy in our list
            for proxy_url in PROXY_LIST:
                try:
                    clean_proxy_url = proxy_url.strip()
                    if not clean_proxy_url:
                        continue
                    
                    print(f"Attempting to use proxy: {clean_proxy_url}")

                    proxy_config = GenericProxyConfig(
                        http_url=clean_proxy_url,
                        https_url=clean_proxy_url
                    )
                    api = YouTubeTranscriptApi(proxy_config=proxy_config)
                    
                    transcript_data = api.fetch(video_id)
                    
                    print("Proxy successful!")
                    break 

                except Exception as e:
                    last_error = str(e)
                    print(f"Proxy {clean_proxy_url} failed: {last_error}")
                    continue

            if not transcript_data:
                raise Exception(f"All curated proxies failed. Last error: {last_error}" if last_error else "Proxy list is empty.")

            full_transcript = " ".join([segment.text for segment in transcript_data])

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
