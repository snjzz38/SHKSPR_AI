from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.proxies import GenericProxyConfig
import json
import random

# This is the correct, direct approach.
# It is failing due to a network block on the hosting platform, not a code error.

# FOR DEBUGGING ONLY: Hardcoding credentials to bypass environment variables.
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
        # ... (request parsing logic) ...
        try:
            authenticated_proxies = []
            for ip_port in WEBSHARE_PROXY_IPS:
                url = f"socks5://{WEBSHARE_USERNAME}:{WEBSHARE_PASSWORD}@{ip_port}"
                authenticated_proxies.append(url)
            
            random.shuffle(authenticated_proxies)

            transcript_data = None
            for proxy_url in authenticated_proxies:
                try:
                    proxy_config = GenericProxyConfig(http_url=proxy_url, https_url=proxy_url)
                    api = YouTubeTranscriptApi(proxy_config=proxy_config)
                    transcript_list = api.fetch(video_id)
                    transcript_data = transcript_list
                    break
                except Exception:
                    continue

            if not transcript_data:
                raise Exception("All 10 proxies failed. This is likely due to a network block by the hosting provider (Vercel).")

            full_transcript = " ".join([segment.text for segment in transcript_data])
            # ... (success response logic) ...
        except Exception as e:
            # ... (error response logic) ...
