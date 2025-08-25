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

random.shuffle(PROXY_LIST)

TRANSCRIPT_CACHE: Dict[str, Dict] = {}
CACHE_TTL = 600  # 10 minutes

HEALTHY_PROXIES: list = PROXY_LIST.copy()
HEALTH_CHECK_INTERVAL = 60
PROXY_TIMEOUT = 8.0

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
]

TRANSCRIPT_URL = "https://www.youtube.com/api/timedtext?video_id={video_id}&fmt=json3&lang=en"

# ========================
# 🧪 Proxy Health Checker
# ========================

async def is_proxy_healthy(proxy: str, test_video_id: str = "dQw4w9WgXcQ") -> bool:
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
    global HEALTHY_PROXIES
    print("[Health Monitor] Starting health checks...")
    while True:
        print("[Health Monitor] Checking proxy health...")
        tasks = [is_proxy_healthy(proxy) for proxy in PROXY_LIST]
        results = await asyncio.gather(*tasks)
        healthy = [proxy for proxy, ok in zip(PROXY_LIST, results) if ok]
        HEALTHY_PROXIES[:] = healthy
        print(f"[Health Monitor] {len(healthy)}/{len(PROXY_LIST)} proxies healthy.")
        await asyncio.sleep(HEALTH_CHECK_INTERVAL)

# ========================
# 🌐 Transcript Fetcher
# ========================

async def fetch_transcript_from_proxy(video_id: str, proxy: str) -> Tuple[Optional[str], Optional[str]]:
    url = TRANSCRIPT_URL.format(video_id=video_id)
    timeout = aiohttp.ClientTimeout(total=PROXY_TIMEOUT)
    headers = {"User-Agent": random.choice(USER_AGENTS)}

    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(url, proxy=proxy, headers=headers) as response:
                if response.status != 200:
                    text = await response.text()
                    return None, f"HTTP {response.status}: {text[:100]}"
                try:
                    data = await response.json()
                    text_parts = []
                    for entry in data.get("events", []):
                        if "segs" in entry:
                            for seg in entry["segs"]:
                                text_parts.append(seg.get("utf8", ""))
                    return " ".join(text_parts).strip(), None
                except Exception as e:
                    body = await response.text()
                    return None, f"JSON parse failed: {str(e)} | Body: {body[:200]}"
    except asyncio.TimeoutError:
        return None, "Timeout"
    except Exception as e:
        return None, f"Request failed: {type(e).__name__}: {str(e)}"

async def fetch_transcript_with_proxies(video_id: str, max_concurrent: int = 8) -> Dict:
    global HEALTHY_PROXIES
    if not HEALTHY_PROXIES:
        return {"success": False, "error": "No healthy proxies available."}

    candidates = random.sample(HEALTHY_PROXIES, min(max_concurrent, len(HEALTHY_PROXIES)))
    tasks = [fetch_transcript_from_proxy(video_id, proxy) for proxy in candidates]

    done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)

    for task in done:
        transcript, error = await task
        if transcript:
            for t in pending:
                t.cancel()
            return {"success": True, "transcript": transcript}

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
    if item and time.time() - item["time"] < CACHE_TTL:
        return item["text"]
    elif item:
        TRANSCRIPT_CACHE.pop(video_id, None)
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
    def send_json_response(self, status: int, data: dict):
        self.send_response(status)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

    def do_GET(self):
        try:
            query_components = parse_qs(urlparse(self.path).query)
            video_id = query_components.get('video_id', [None])[0]

            if not video_id:
                self.send_json_response(400, {"error": "video_id parameter is required"})
                return

            video_id = video_id.split("&")[0][:11]
            if len(video_id) != 11:
                self.send_json_response(400, {"error": "Invalid YouTube video_id format"})
                return

            # Check cache
            cached = get_cached_transcript(video_id)
            if cached:
                self.send_json_response(200, {
                    "video_id": video_id,
                    "transcript": cached,
                    "source": "cache"
                })
                print(f"✅ Cache HIT for {video_id}")
                return

            # Fetch live
            try:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                result = loop.run_until_complete(fetch_transcript_with_proxies(video_id))
                loop.close()
            except Exception as e:
                print(f"🚨 Async error: {e}")
                self.send_json_response(500, {"error": "Fetch failed", "details": str(e)})
                return

            if result["success"]:
                cache_transcript(video_id, result["transcript"])
                self.send_json_response(200, {
                    "video_id": video_id,
                    "transcript": result["transcript"],
                    "source": "live"
                })
                print(f"✅ Fetched transcript for {video_id}")
            else:
                self.send_json_response(500, {
                    "error": "Failed to fetch transcript",
                    "details": result["error"]
                })

        except Exception as e:
            print(f"🚨 Unexpected error in handler: {e}")
            self.send_json_response(500, {"error": "Internal server error"})

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
    # Start health monitor
    monitor_thread = Thread(target=lambda: asyncio.run(health_monitor()), daemon=True)
    monitor_thread.start()

    # Start server
    run_server()
