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

# Helper function for parallel processing
def fetch_with_proxy(proxy_url, video_id):
    try:
        proxy_config = GenericProxyConfig(http_url=proxy_url, https_url=proxy_url)
        api = YouTubeTranscriptApi(proxy_config=proxy_config)
        transcript_list = api.fetch(video_id)
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
            
            BATCH_SIZE = 4
            proxy_batches = [formatted_proxies[i:i + BATCH_SIZE] for i in range(0, len(formatted_proxies), BATCH_SIZE)]

            for i, batch in enumerate(proxy_batches):
                print(f"--- Testing Batch {i+1}/{len(proxy_batches)} ---")
                with concurrent.futures.ThreadPoolExecutor(max_workers=BATCH_SIZE) as executor:
                    future_to_proxy = {executor.submit(fetch_with_proxy, url, video_id): url for url in batch}
                    
                    for future in concurrent.futures.as_completed(future_to_proxy):
                        result = future.result()
                        if result:
                            proxy_url = future_to_proxy[future]
                            # --- THIS IS THE CORRECTED LOGGING LINE ---
                            # It safely splits by "//" to get the IP and port.
                            proxy_display = proxy_url.split('//')[1]
                            print(f"Success found in batch {i+1}! Proxy: {proxy_display}")
                            
                            transcript_data = result
                            executor.shutdown(wait=False, cancel_futures=True)
                            break 
                
                if transcript_data:
                    break 

            if not transcript_data:
                raise Exception("All proxies in all batches failed. The proxies may be offline or YouTube has blocked them. A new list may be needed.")

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
