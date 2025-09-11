from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.proxies import GenericProxyConfig
import json
import random

# --- Curated proxy list (HTTP, HTTPS, SOCKS4, SOCKS5) ---
PROXY_LIST = [
    "socks4://89.42.198.79:4153",     # IR
    "socks4://160.251.6.106:10008",   # JP
    "socks4://157.66.141.247:8181",   # ID
    "socks4://185.171.54.34:2695",    # IR
    "socks5://185.25.119.57:7497",    # UA
    "socks4://162.214.198.15:35047",  # US
    "socks4://212.120.186.39:52914",  # RU
    "socks4://175.29.174.242:10800",  # BD
    "socks4://109.92.138.250:5678",   # RS
    "socks4://79.173.75.182:3629"     # RU
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

        transcript_data = None
        last_error = None

        try:
            # Shuffle proxies to avoid hammering one endpoint
            random.shuffle(PROXY_LIST)

            for proxy_url in PROXY_LIST:
                try:
                    clean_proxy_url = proxy_url.strip()
                    if not clean_proxy_url:
                        continue

                    print(f"Attempting to use proxy: {clean_proxy_url}")

                    # Use same proxy for both http and https
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
                raise Exception(f"All proxies failed. Last error: {last_error}" if last_error else "Proxy list is empty.")

            # Combine transcript into a single string
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
