import asyncio
import aiohttp
import json
import random
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs
from threading import Thread
from typing import Dict, Optional, Tuple

# ========================
# 🔧 CONFIGURATION
# ========================

# List of reliable HTTPS proxies (manually curated, geographically close to US/CA)
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

# Shuffle once to avoid predictable order
random.shuffle(PROXY_LIST)

# Cache: video_id -> { 'text': str, 'time': float }
TRANSCRIPT_CACHE: Dict[str, Dict] = {}
CACHE_TTL = 600  # 10 minutes

# Healthy proxies (updated by background monitor)
HEALTHY_PROXIES: list = PROXY_LIST.copy()
HEALTH_CHECK_INTERVAL = 60  # seconds
PROXY_TIMEOUT = 8.0

# User-Agent rotation to avoid blocking
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
]

# YouTube Transcript API URL
TRANSCRIPT_URL = "https://www.youtube.com/api/timedtext?video_id={video_id}&fmt=json3&lang=en"


# ========================
# 🧪 Proxy Health Checker
# ========================

async def is_proxy_healthy(proxy: str, test_video_id: str = "dQw4w9WgXcQ") -> bool:
    """Check if a proxy can fetch a transcript."""
    url = TRANSCRIPT_URL.format(video_id=test_video_id)
    timeout = aiohttp.ClientTimeout(total=PROXY_TIMEOUT)
    headers = {"User-Agent": random.choice(USER_AGENTS)}
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(url, proxy=proxy, headers=headers) as resp:
                return resp.status == 200
    except Exception:
        return False


async def health_monitor():
    """Background task to periodically check proxy health."""
    global HEALTHY_PROXIES
    while True:
        print("[Health Monitor] Checking proxy health...")
        healthy = []
        tasks = [is_proxy_healthy(proxy) for proxy in PROXY_LIST]
        results = await asyncio.gather(*tasks)
        for proxy, is_ok in zip(PROXY_LIST, results):
            if is_ok:
                healthy.append(proxy)
        HEALTHY_PROXIES[:] = healthy  # Replace in-place
        print(f"[Health Monitor] {len(healthy)} proxies are healthy.")
        await asyncio.sleep(HEALTH_CHECK_INTERVAL)


# ========================
# 🌐 Transcript Fetcher
# ========================

async def fetch_transcript_from_proxy(video_id: str, proxy: str) -> Tuple[Optional[str], Optional[str]]:
    """Fetch transcript using a single proxy."""
    url = TRANSCRIPT_URL.format(video_id=video_id)
    timeout = aiohttp.ClientTimeout(total=PROXY_TIMEOUT)
    headers = {"User-Agent": random.choice(USER_AGENTS)}

    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(url, proxy=proxy, headers=headers) as response:
                if response.status != 200:
                    return None, f"HTTP {response.status}"
                try:
                    data = await response.json()
                    # Extract text from events
                    text = " ".join(
                        entry.get("segs", [{"utf8": ""}])[0]["utf8"]
                        for entry in data.get("events", [])
                        if "segs" in entry and entry["segs"]
                    )
                    return text.strip(), None
                except Exception as e:
                    return None, f"Parse error: {str(e)}"
    except asyncio.TimeoutError:
        return None, "Timeout"
    except Exception as e:
        return None, f"Request failed: {str(e)}"


async def fetch_transcript_with_proxies(video_id: str, max_concurrent: int = 8) -> Dict:
    """Try multiple proxies concurrently, return first successful result."""
    global HEALTHY_PROXIES
    if not HEALTHY_PROXIES:
        return {"success": False, "error": "No healthy proxies available."}

    # Use up to `max_concurrent` proxies
    candidates = random.sample(HEALTHY_PROXIES, min(max_concurrent, len(HEALTHY_PROXIES)))
    tasks = [fetch_transcript_from_proxy(video_id, proxy) for proxy in candidates]

    done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)

    for task in done:
        transcript, error = await task
        if transcript:
            # Cancel pending tasks
            for t in pending:
                t.cancel()
            return {"success": True, "transcript": transcript}

    # If none succeeded, return last error
    last_error = "All proxies failed."
    for task in done:
        _, err = await task
        if err:
            last_error = err
    return {"success": False, "error": last_error}


# ========================
# 📦 Caching Layer
# ========================

def get_cached_transcript(video_id: str) -> Optional[str]:
    item = TRANSCRIPT_CACHE.get(video_id)
    if not item:
        return None
    if time.time() - item["time"] < CACHE_TTL:
        return item["text"]
    else:
        del TRANSCRIPT_CACHE[video_id]
        return None


def cache_transcript(video_id: str, transcript: str):
    TRANSCRIPT_CACHE[video_id] = {
        "text": transcript,
        "time": time.time()
    }


# ========================
# 🖥️ HTTP Request Handler
# ========================

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        # Parse video_id
        query_components = parse_qs(urlparse(self.path).query)
        video_id = query_components.get('video_id', [None])[0]

        if not video_id:
            self.send_error(400, json.dumps({"error": "video_id parameter is required"}))
            return

        # Clean video_id (remove extra params)
        video_id = video_id.split("&")[0][:150]  # Max reasonable length

        # Check cache first
        cached = get_cached_transcript(video_id)
        if cached:
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('X-Cache', 'HIT')
            self.end_headers()
            self.wfile.write(json.dumps({"transcript": cached}).encode('utf-8'))
            print(f"Cache HIT for video_id={video_id}")
            return

        # Run async fetch
        try:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            result = loop.run_until_complete(fetch_transcript_with_proxies(video_id))
            loop.close()
        except Exception as e:
            self.send_error(500, json.dumps({"error": f"Server error: {str(e)}"}))
            return

        if result["success"]:
            cache_transcript(video_id, result["transcript"])
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('X-Cache', 'MISS')
            self.end_headers()
            self.wfile.write(json.dumps({"transcript": result["transcript"]}).encode('utf-8'))
            print(f"Cache MISS (fetched) for video_id={video_id}")
        else:
            self.send_error(500, json.dumps({"error": result["error"]}))

    def send_error(self, code: int, content: str = ""):
        self.send_response(code)
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        self.wfile.write(content.encode('utf-8'))


# ========================
# ▶️ Start Server + Monitor
# ========================

def run_server():
    port = 8000
    server = HTTPServer(('localhost', port), handler)
    print(f"🚀 Server running on http://localhost:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n🛑 Server stopped.")


if __name__ == "__main__":
    # Start health monitor in background
    def start_monitor():
        asyncio.run(health_monitor())

    monitor_thread = Thread(target=start_monitor, daemon=True)
    monitor_thread.start()

    # Start HTTP server
    run_server()
