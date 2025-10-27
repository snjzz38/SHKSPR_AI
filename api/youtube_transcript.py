from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.proxies import GenericProxyConfig
import json
import random
import concurrent.futures

# Your curated "Platinum List" of proxies proven to work with YouTube.
PLATINUM_PROXY_LIST = [
    "77.246.100.210:8080", "160.25.8.26:11011", "118.70.151.55:1080",
    "223.25.109.114:8199", "43.133.37.149:1080", "220.247.166.135:8008",
    "160.25.8.162:11011", "202.136.88.210:11011", "43.131.9.114:1777",
    "115.127.107.106:1080", "38.183.144.18:1080", "46.10.229.243:7777",
    "103.118.175.165:8199"
]

# --- Helper function for parallel processing ---
def fetch_with_proxy(proxy_url, video_id):
    """Attempts to fetch a transcript with a single proxy. Returns transcript if successful, None otherwise."""
    try:
        print(f"Attempting proxy: {proxy_url.split('@')[1]}") # Print without credentials
        proxy_config = GenericProxyConfig(http_url=proxy_url, https_url=proxy_url)
        api = YouTubeTranscriptApi(proxy_config=proxy_config)
        transcript_list = api.fetch(video_id)
        print(f"Proxy successful: {proxy_url.split('@')[1]}")
        return transcript_list
    except Exception:
        return None

class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        query_components = parse_qs(urlparse(self.path).query)
        video_id = query_components.get('video_id', [None])[0]

        if not video_id:
            # ... (error handling)
            return

        try:
            if not PLATINUM_PROXY_LIST:
                raise Exception("The proxy list is empty.")

            formatted_proxies = [f"socks5://{proxy}" for proxy in PLATINUM_PROXY_LIST]
            random.shuffle(formatted_proxies)

            transcript_data = None
            # --- NEW: Parallel Processing Logic ---
            # We will try up to 8 proxies at the same time.
            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
                # Create a future for each proxy task
                future_to_proxy = {executor.submit(fetch_with_proxy, url, video_id): url for url in formatted_proxies}
                
                # Wait for the first one to complete successfully
                for future in concurrent.futures.as_completed(future_to_proxy):
                    result = future.result()
                    if result:
                        transcript_data = result
                        # Once we have a success, we shut down all other waiting tasks.
                        executor.shutdown(wait=False, cancel_futures=True)
                        break

            if not transcript_data:
                raise Exception("All proxies in your platinum list failed. They may have gone offline. A new list may be needed.")

            # --- Process and Return the Transcript ---
            full_transcript = " ".join([segment.text for segment in transcript_data])

            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'transcript': full_transcript}).encode('utf-8'))

        except Exception as e:
            # ... (error handling)
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': f'An error occurred: {str(e)}'}).encode('utf-8'))
            
        return
