import asyncio
import aiohttp
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import json
import random

# --- Optimized Proxy List (HTTPS-enabled, fast, North America) ---
PROXY_LIST = [
    "http://51.79.99.237:4502",
    "http://43.154.134.238:50001",
    "http://72.10.164.178:28247",
    "http://195.158.8.123:3128",
    "http://85.239.144.149:8080",
    "http://147.75.34.74:10019",
    "http://157.180.121.252:46206",
    "http://51.161.56.52:80",
    "http://209.121.164.50:31147",
    "http://147.75.34.105:443",
    "http://72.10.160.90:3581",
    "http://94.73.239.124:55443",
    "http://31.220.78.244:80",
    "http://37.27.6.46:80",
    "http://65.108.203.35:28080",
    "http://67.43.236.19:3527",
    "http://65.108.159.129:8081",
    "http://72.10.160.170:3949",
    "http://72.10.160.173:19329",
    "http://65.108.203.36:28080",
    "http://67.43.228.250:7015"
]

# Shuffle proxies once to avoid repeating same order
random.shuffle(PROXY_LIST)

# Global session (reuse TCP connections)
SESSION = None

async def fetch_transcript(video_id: str, proxy_url: str, timeout: float = 10.0):
    url = f"https://www.youtube.com/api/timedtext?video_id={video_id}&fmt=json3&lang=en"
    connector = aiohttp.TCPConnector(limit=10, ssl=False)
    timeout_config = aiohttp.ClientTimeout(total=timeout)

    async with aiohttp.ClientSession(connector=connector, timeout=timeout_config) as session:
        try:
            async with session.get(url, proxy=proxy_url) as response:
                if response.status != 200:
                    return None, f"HTTP {response.status}"
                try:
                    data = await response.json()
                    text = " ".join([entry['text'] for entry in data['events'] if 'text' in entry])
                    return text, None
                except Exception as e:
                    return None, f"Parse error: {str(e)}"
        except asyncio.TimeoutError:
            return None, "Timeout"
        except Exception as e:
            return None, str(e)

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        # Extract video_id
        query_components = parse_qs(urlparse(self.path).query)
        video_id = query_components.get('video_id', [None])[0]

        if not video_id:
            self.send_response(400)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': 'video_id parameter is required'}).encode('utf-8'))
            return

        # Run async event loop
        try:
            # Use a new event loop for each request (safe for CGI/simple server)
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            result = loop.run_until_complete(self.get_transcript_with_proxies(video_id))
            loop.close()
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': f'Server error: {str(e)}'}).encode('utf-8'))
            return

        if result['success']:
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'transcript': result['transcript']}).encode('utf-8'))
        else:
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': result['error']}).encode('utf-8'))

    async def get_transcript_with_proxies(self, video_id: str):
        tasks = []
        # Limit to top N proxies (e.g., 5 fastest) to avoid overhead
        for proxy in PROXY_LIST[:8]:  # Try up to 8 in parallel
            tasks.append(fetch_transcript(video_id, proxy))

        # Wait for the first successful response
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)

        for task in done:
            transcript, error = await task
            if transcript is not None:
                # Cancel pending tasks
                for p in pending:
                    p.cancel()
                return {'success': True, 'transcript': transcript}

        # If all failed, return last error
        for task in done:
            _, error = await task
            if error:
                last_error = error
        return {'success': False, 'error': f'All proxies failed. Last error: {last_error}'}
