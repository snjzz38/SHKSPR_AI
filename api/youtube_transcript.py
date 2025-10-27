from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.proxies import GenericProxyConfig
import json
import random

# A random sample of 40 proxies from the large list you provided.
# This is a balance between having enough options and avoiding the Vercel 10-second timeout.
PUBLIC_PROXY_LIST = [
    "213.143.113.82:80", "190.202.111.202:8080", "184.178.172.26:4145",
    "24.249.199.4:4145", "198.199.86.11:80", "47.76.144.139:8008",
    "162.144.74.156:3620", "143.92.61.148:8082", "154.66.108.52:3629",
    "60.190.195.146:10800", "160.19.16.86:1080", "193.31.127.253:8085",
    "74.48.194.151:1080", "47.252.18.37:3129", "123.182.233.70:7302",
    "123.30.154.171:7777", "107.181.132.111:6089", "140.245.102.185:3128",
    "88.218.46.173:8085", "199.96.165.12:8085", "91.222.238.112:80",
    "72.10.160.94:17385", "95.173.218.76:8081", "67.43.228.250:16043",
    "200.54.22.74:8080", "34.23.45.223:80", "54.38.181.125:3128",
    "138.68.235.51:80", "193.233.220.140:8085", "104.143.224.98:5959",
    "109.230.92.50:3128", "154.19.44.22:8085", "8.211.51.115:9080",
    "62.201.217.243:40010", "176.88.166.215:1080", "193.202.16.18:8085",
    "65.108.159.129:8081", "128.140.113.110:3128", "141.147.9.254:80",
    "139.59.1.14:3128"
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
            # 1. Format the proxy list for SOCKS5 connection
            # We assume these are SOCKS5 proxies as requested.
            formatted_proxies = [f"socks5://{proxy}" for proxy in PUBLIC_PROXY_LIST]
            
            print(f"Constructed {len(formatted_proxies)} SOCKS5 proxies from public list. Shuffling and testing...")
            random.shuffle(formatted_proxies)

            # 2. Try each proxy until one succeeds
            transcript_data = None
            for i, proxy_url in enumerate(formatted_proxies):
                print(f"Attempting SOCKS5 proxy {i+1}/{len(formatted_proxies)}")
                try:
                    proxy_config = GenericProxyConfig(http_url=proxy_url, https_url=proxy_url)
                    api = YouTubeTranscriptApi(proxy_config=proxy_config)
                    transcript_list = api.fetch(video_id)
                    
                    transcript_data = transcript_list
                    print(f"Proxy successful!")
                    break
                except Exception as e:
                    # This is expected for public lists, so we keep the message brief.
                    print(f"Proxy attempt failed.")
                    continue

            if not transcript_data:
                raise Exception("All proxies in the random sample failed. This is common with public lists due to them being slow, offline, or blocked by YouTube. Please try again.")

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
