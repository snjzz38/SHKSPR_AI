# youtube_transcript.py
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs
import json
import random
import urllib.request
import urllib.error
import socket
import ssl

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
]

# --- Helper to send consistent JSON responses ---
def send_json_response(handler, status_code, data_dict):
    """Helper to send a JSON response, ensuring headers and encoding are correct."""
    try:
        handler.send_response(status_code)
        handler.send_header('Content-type', 'application/json')
        handler.send_header('Access-Control-Allow-Origin', '*') # Allow frontend requests
        handler.end_headers()
        json_data = json.dumps(data_dict)
        handler.wfile.write(json_data.encode('utf-8'))
    except Exception as e:
        # If sending JSON fails, log it. The client might get garbled data, but the server won't crash.
        print(f"CRITICAL ERROR: Failed to send JSON response: {e}")

# --- Core logic to fetch transcript with retries ---
def fetch_transcript_with_retries(video_id, proxy_list, max_retries=3):
    """Attempts to fetch the transcript using multiple proxies."""
    last_error = "No proxies available or all failed."

    # Shuffle the list to try different proxies each time
    shuffled_proxies = proxy_list[:] # Copy list
    random.shuffle(shuffled_proxies)

    for proxy_url in shuffled_proxies:
        try:
            clean_proxy_url = proxy_url.strip()
            if not clean_proxy_url:
                continue

            print(f"Attempting to use proxy: {clean_proxy_url}")

            # Construct the YouTube Transcript API URL
            transcript_url = f"https://www.youtube.com/api/timedtext?video_id={video_id}&fmt=json3&lang=en"

            # Create a ProxyHandler
            proxy_handler = urllib.request.ProxyHandler({'http': clean_proxy_url, 'https': clean_proxy_url})
            opener = urllib.request.build_opener(proxy_handler)

            # Add a User-Agent header to mimic a browser request
            opener.addheaders = [('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36')]

            # Create the request
            request = urllib.request.Request(transcript_url)

            # Set a timeout for the request
            timeout = 15 # seconds

            # Make the request
            with opener.open(request, timeout=timeout) as response:
                if response.getcode() == 200:
                    data = response.read()
                    json_data = json.loads(data.decode('utf-8'))

                    # Extract the transcript text
                    events = json_data.get('events', [])
                    transcript_parts = []
                    for event in events:
                        if 'segs' in event:
                            for seg in event['segs']:
                                if 'utf8' in seg:
                                    transcript_parts.append(seg['utf8'])
                    full_transcript = "".join(transcript_parts).strip()

                    if full_transcript:
                        print("Transcript fetched successfully!")
                        return full_transcript
                    else:
                         print(f"Proxy {clean_proxy_url} returned empty transcript.")
                         last_error = "Transcript was empty."
                else:
                    print(f"Proxy {clean_proxy_url} returned status code: {response.getcode()}")
                    last_error = f"HTTP {response.getcode()}"

        except urllib.error.HTTPError as e:
            print(f"HTTP Error with proxy {clean_proxy_url}: {e.code} - {e.reason}")
            last_error = f"HTTP Error {e.code}: {e.reason}"
        except urllib.error.URLError as e:
            print(f"URL Error with proxy {clean_proxy_url}: {e.reason}")
            last_error = f"URL Error: {e.reason}"
        except socket.timeout:
            print(f"Timeout Error with proxy {clean_proxy_url}")
            last_error = "Timeout"
        except ssl.SSLError as e:
            print(f"SSL Error with proxy {clean_proxy_url}: {e}")
            last_error = f"SSL Error: {e}"
        except json.JSONDecodeError as e:
            print(f"JSON Decode Error with proxy {clean_proxy_url}: {e}")
            last_error = f"JSON Error: Invalid response format"
        except Exception as e:
             print(f"Unexpected error with proxy {clean_proxy_url}: {e}")
             last_error = f"Unexpected Error: {str(e)}"

        # If we reach here, the current proxy failed. Continue to the next one.

    # If the loop finishes, all proxies failed
    print(f"All proxies failed. Last error: {last_error}")
    return None


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        """Handles GET requests to /api/youtube_transcript."""
        try:
            # 1. Parse the URL and query parameters
            parsed_path = urlparse(self.path)
            query_components = parse_qs(parsed_path.query)
            video_id = query_components.get('video_id', [None])[0]

            # 2. Validate input
            if not video_id:
                 send_json_response(self, 400, {'error': 'video_id parameter is required'})
                 return

            # 3. Attempt to fetch the transcript
            transcript_data = fetch_transcript_with_retries(video_id, PROXY_LIST)

            # 4. Send response
            if transcript_data:
                send_json_response(self, 200, {'transcript': transcript_data})
            else:
                # Use a generic error message to avoid leaking internal details
                send_json_response(self, 500, {'error': 'Could not fetch transcript. Please try again later.'})

        except Exception as e:
            # 5. Catch any unexpected errors in the handler itself
            print(f"CRITICAL SERVER ERROR in handler: {e}")
            # Always send JSON, even on crashes
            send_json_response(self, 500, {'error': 'An internal server error occurred.'})


    def do_OPTIONS(self):
        # Handle preflight CORS requests if your frontend makes them
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    # Mute default logging if desired
    def log_message(self, format, *args):
        return # Override to disable default logging if needed


if __name__ == "__main__":
    port = 8000
    server_address = ('localhost', port)
    httpd = HTTPServer(server_address, handler)
    print(f"🚀 YouTube Transcript API Server running on http://localhost:{port}")
    print("💡 Test with: curl 'http://localhost:8000/api/youtube_transcript?video_id=dQw4w9WgXcQ'")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n🛑 Server stopped.")
