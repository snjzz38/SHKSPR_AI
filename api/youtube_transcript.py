# youtube_transcript.py
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import json
import random
import requests
import concurrent.futures
import time
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.proxies import GenericProxyConfig

# --- A manually curated list of promising HTTPS proxies ---
# Ensure these are known to work with HTTPS CONNECT for YouTube
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
]

# --- Configuration ---
# Timeout for each individual proxy request attempt
PROXY_TIMEOUT_SECONDS = 8
# Maximum number of proxies to try concurrently
MAX_CONCURRENT_PROXIES = 8
# Timeout for the entire concurrent fetching process
TOTAL_TIMEOUT_SECONDS = 15

# --- Helper Functions ---

def send_json_response(handler, status_code, data_dict):
    """Sends a consistent JSON response."""
    try:
        handler.send_response(status_code)
        handler.send_header('Content-type', 'application/json')
        handler.send_header('Access-Control-Allow-Origin', '*') # Essential for frontend
        handler.end_headers()
        json_data = json.dumps(data_dict)
        handler.wfile.write(json_data.encode('utf-8'))
    except Exception as e:
        # Log critical errors but don't let them crash the handler further
        print(f"CRITICAL ERROR sending JSON response: {e}")

def fetch_transcript_direct(video_id, proxy_url):
    """
    Tries to fetch the transcript directly using requests.
    This is often faster and more reliable.
    """
    try:
        transcript_url = f"https://www.youtube.com/api/timedtext?video_id={video_id}&fmt=json3&lang=en"
        proxies = {'http': proxy_url, 'https': proxy_url}
        
        # Use a session for potential connection reuse if requests were sequential
        # But for single call, it's fine.
        # Add a User-Agent to mimic a browser
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }

        response = requests.get(
            transcript_url,
            proxies=proxies,
            headers=headers,
            timeout=PROXY_TIMEOUT_SECONDS
        )
        response.raise_for_status() # Raise exception for bad status codes (4xx, 5xx)

        json_data = response.json()

        # Extract the transcript text robustly
        events = json_data.get('events', [])
        transcript_parts = []
        for event in events:
            if 'segs' in event:
                for seg in event['segs']:
                    if 'utf8' in seg:
                        transcript_parts.append(seg['utf8'])
        full_transcript = "".join(transcript_parts).strip()

        if full_transcript:
            print(f"Direct fetch SUCCESS via proxy: {proxy_url}")
            return full_transcript
        else:
            print(f"Direct fetch returned empty transcript via proxy: {proxy_url}")
            return None

    except requests.exceptions.Timeout:
        print(f"Direct fetch TIMEOUT via proxy: {proxy_url}")
        return None
    except requests.exceptions.RequestException as e:
        # Catches HTTP errors, connection errors, etc.
        print(f"Direct fetch REQUEST ERROR via proxy {proxy_url}: {e}")
        return None
    except json.JSONDecodeError as e:
        print(f"Direct fetch JSON ERROR via proxy {proxy_url}: {e}")
        return None
    except Exception as e:
        print(f"Direct fetch UNEXPECTED ERROR via proxy {proxy_url}: {e}")
        return None

def fetch_transcript_via_yt_api(video_id, proxy_url):
    """
    Fallback: Uses youtube-transcript-api with a specific proxy.
    """
    try:
        print(f"Falling back to youtube-transcript-api via proxy: {proxy_url}")
        proxy_config = GenericProxyConfig(
            http_url=proxy_url,
            https_url=proxy_url
        )
        api = YouTubeTranscriptApi(proxy_config=proxy_config)
        transcript_data = api.fetch(video_id)
        if transcript_data:
            full_transcript = " ".join([segment.text for segment in transcript_data]).strip()
            if full_transcript:
                 print(f"YT-API fetch SUCCESS via proxy: {proxy_url}")
                 return full_transcript
        print(f"YT-API fetch returned empty transcript via proxy: {proxy_url}")
        return None
    except Exception as e:
        print(f"YT-API fetch FAILED via proxy {proxy_url}: {e}")
        return None

def fetch_with_proxy(video_id, proxy_url):
    """
    Wrapper to try direct method first, then fallback.
    """
    # Try direct method first
    transcript = fetch_transcript_direct(video_id, proxy_url)
    if transcript:
        return transcript
    # Fallback to youtube-transcript-api if direct fails
    return fetch_transcript_via_yt_api(video_id, proxy_url)

def fetch_transcript_concurrent(video_id, proxy_list):
    """
    Fetches transcript by trying multiple proxies concurrently.
    Returns the transcript from the first successful one.
    """
    shuffled_proxies = proxy_list[:] # Copy list
    random.shuffle(shuffled_proxies)
    # Limit the number of proxies we try concurrently to avoid overwhelming
    proxies_to_try = shuffled_proxies[:MAX_CONCURRENT_PROXIES]

    print(f"Attempting to fetch transcript for video ID: {video_id} using up to {len(proxies_to_try)} proxies concurrently...")

    # Use ThreadPoolExecutor for concurrent requests
    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_CONCURRENT_PROXIES) as executor:
        # Submit all fetch tasks
        future_to_proxy = {executor.submit(fetch_with_proxy, video_id, proxy): proxy for proxy in proxies_to_try}

        # Wait for the first success or until total timeout
        try:
            # Use as_completed with a timeout on the entire process
            for future in concurrent.futures.as_completed(future_to_proxy, timeout=TOTAL_TIMEOUT_SECONDS):
                transcript = future.result() # Get the result of the completed task
                if transcript:
                    successful_proxy = future_to_proxy[future]
                    print(f"SUCCESS: Transcript fetched via proxy {successful_proxy}")
                    return transcript
        except concurrent.futures.TimeoutError:
            print(f"TIMEOUT: No successful fetch within {TOTAL_TIMEOUT_SECONDS} seconds.")
            return None

    print("FAILED: All concurrent proxy attempts finished, but none were successful.")
    return None # If loop finishes, no proxy succeeded


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        """Handles GET requests to fetch YouTube transcript."""
        try:
            # 1. Parse URL and query parameters
            parsed_path = urlparse(self.path)
            query_components = parse_qs(parsed_path.query)
            video_id = query_components.get('video_id', [None])[0]

            # 2. Validate input
            if not video_id:
                send_json_response(self, 400, {'error': 'video_id parameter is required'})
                return

            # 3. Attempt to fetch the transcript concurrently
            transcript_data = fetch_transcript_concurrent(video_id, PROXY_LIST)

            # 4. Send response
            if transcript_data:
                send_json_response(self, 200, {'transcript': transcript_data})
            else:
                # Use a generic error message
                send_json_response(self, 500, {'error': 'Could not fetch transcript. Please try again later.'})

        except Exception as e:
            # 5. Catch any unexpected errors in the handler itself
            print(f"CRITICAL SERVER ERROR in handler: {e}")
            # Always send JSON, even on crashes
            send_json_response(self, 500, {'error': 'An internal server error occurred.'})

    def do_OPTIONS(self):
        # Handle preflight CORS requests
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    # Optional: Mute default logging if it's too verbose
    # def log_message(self, format, *args):
    #     return


# --- For local testing ---
if __name__ == "__main__":
    from http.server import HTTPServer
    port = 8000
    server_address = ('localhost', port)
    httpd = HTTPServer(server_address, handler)
    print(f"🚀 Optimized YouTube Transcript API Server running on http://localhost:{port}")
    print("💡 Test with: curl 'http://localhost:8000?video_id=dQw4w9WgXcQ'")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n🛑 Server stopped.")
