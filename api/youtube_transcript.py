#!/usr/bin/env python3
"""
YouTube Transcript API Server with Proxy Support, Caching & Health Checks

Usage:
    python youtube_transcript.py

Test:
    curl "http://localhost:8000?video_id=dQw4w9WgXcQ"
"""

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

# List of reliable HTTPS proxies (manually curated, North America)
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

# Shuffle to avoid bias
random.shuffle(PROXY_LIST)

# Cache: video_id -> { text, time }
TRANSCRIPT_CACHE: Dict[str, Dict] = {}
CACHE_TTL = 600  # 10 minutes

# Healthy proxies (updated by monitor)
HEALTHY_PROXIES: list = PROXY_LIST.copy()
HEALTH_CHECK_INTERVAL = 60  # seconds
PROXY_TIMEOUT = 10.0

# Rotate User-Agent
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
    """Check if proxy can fetch a transcript."""
    url = TRANSCRIPT_URL.format(video_id=test_video_id)
    timeout = aiohttp.ClientTimeout(total=PROXY_TIMEOUT)
    headers = {"User-Agent": random.choice(USER_AGENTS)}
    connector = aiohttp.TCPConnector(ssl=False)  # Avoid SSL issues
    try:
        async with aiohttp.ClientSession(connector=connector, timeout=timeout) as session:
            async with session.get(url, proxy=proxy, headers=headers) as resp:
                return resp.status == 200
    except Exception as e:
        print(f"Health check failed for {proxy}: {type(e).__name__}")
        return False


async def health_monitor():
    """Background task to monitor proxy health."""
    global HEALTHY_PROXIES
    print("[Health Monitor] Starting...")
    while True:
        print("[Health Monitor] Running health check...")
        tasks = [is_proxy_healthy(proxy) for proxy in PROXY_LIST]
        results = await asyncio.gather(*tasks)
        healthy = [proxy for proxy, ok in zip(PROXY_LIST, results) if ok]
        HEALTHY_PROXIES[:] = healthy  # Update in place
        print(f"[Health Monitor] ✅ {len(healthy)} / {len(PROXY_LIST)} proxies healthy")
        await asyncio.sleep(HEALTH_CHECK_INTERVAL)


# ========================
# 🌐 Transcript Fetcher
# ========================

async def fetch_transcript_from_proxy(video_id: str, proxy: str) -> Tuple[Optional[str], Optional[str]]:
    """Fetch transcript using one proxy."""
    url = TRANSCRIPT_URL.format(video_id=video_id)
    timeout = aiohttp.ClientTimeout(total=PROXY_TIMEOUT)
    headers = {"User-Agent": random.choice(USER_AGENTS)}
    connector = aiohttp.TCPConnector(ssl=False)  # Prevent SSL errors

    try:
        async with aiohttp.ClientSession(connector=connector, timeout=timeout) as session:
            async with session.get(url, proxy=proxy, headers=headers) as response:
                if response.status != 200:
                    body = await response.text()
                    return None, f"HTTP {response.status}: {body[:100]}"

                try:
                    data = await response.json()
                    text_parts = []
                    for event in data.get("events", []):
                        if "segs" in event:
                            for seg in event["segs"]:
                                text_parts.append(seg.get("utf8", ""))
                    transcript = " ".join(text_parts).strip()
                    return (transcript, None) if transcript else (None, "Empty transcript")
                except Exception as e:
                    body = await response.text()
                    return None, f"Parse failed: {str(e)} | Body: {body[:150]}"

    except asyncio.TimeoutError:
        return None, "Timeout"
    except Exception as e:
        return None, f"Request failed: {type(e).__name__}: {str(e)}"


async def fetch_transcript_with_proxies(video_id: str, max_concurrent: int = 6) -> Dict:
    """Try multiple proxies concurrently, return first success."""
    global HEALTHY_PROXIES
    if not HEALTHY_PROXIES:
        return {"success": False, "error": "No healthy proxies available"}

    # Use up to N random healthy proxies
    candidates = random.sample(HEALTHY_PROXIES, min(max_concurrent, len(HEALTHY_PROXIES)))
    tasks = [fetch_transcript_from_proxy(video_id, p) for p in candidates]

    done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)

    for task in done:
        try:
            transcript, error = await task
            if transcript:
                for t in pending:
                    t.cancel()
                return {"success": True, "transcript": transcript}
        except:
            pass  # Ignore failed task resolution

    # If all failed, return last error
    errors = []
    for task in done:
        try:
            _, err = await task
            if err:
                errors.append(err)
        except:
            errors.append("Unknown error")
    last_error = errors[-1] if errors else "All proxies failed"
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
    def send_json_response(self, status: int,  dict):
        """Safely send JSON response. Never fail."""
        try:
            self.send_response(status)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            body = json.dumps(data)
            self.wfile.write(body.encode('utf-8'))
        except Exception as e:
            print(f"🔥 Failed to send response: {e}")

    def do_GET(self):
        try:
            # --- Parse video_id ---
            try:
                query = urlparse(self.path)
                query_components = parse_qs(query.query)
                video_id = query_components.get('video_id', [None])[0]

                if not video_id:
                    return self.send_json_response(400, {"error": "video_id parameter is required"})

                video_id = video_id.split("&")[0][:15]  # Allow room
                if not video_id or len(video_id) < 11:
                    return self.send_json_response(400, {"error": "Invalid video_id format"})

                # Trim to 11 chars (standard YouTube ID)
                video_id = video_id[:11]

            except Exception:
                return self.send_json_response(400, {"error": "Malformed query parameters"})

            # --- Check cache ---
            try:
                cached = get_cached_transcript(video_id)
                if cached:
                    return self.send_json_response(200, {
                        "video_id": video_id,
                        "transcript": cached,
                        "source": "cache"
                    })
            except Exception as e:
                print(f"⚠️ Cache lookup failed: {e}")

            # --- Fetch live transcript ---
            try:
                # Get or create event loop
                try:
                    loop = asyncio.get_event_loop()
                except RuntimeError:
                    loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(loop)

                result = loop.run_until_complete(fetch_transcript_with_proxies(video_id))

                if result["success"]:
                    transcript = result["transcript"]
                    cache_transcript(video_id, transcript)
                    return self.send_json_response(200, {
                        "video_id": video_id,
                        "transcript": transcript,
                        "source": "live"
                    })
                else:
                    return self.send_json_response(500, {
                        "error": "Transcript fetch failed",
                        "details": result["error"]
                    })

            except Exception as e:
                print(f"🚨 Fetch execution error: {type(e).__name__}: {e}")
                return self.send_json_response(500, {
                    "error": "Internal fetch error",
                    "details": "Proxy system failed"
                })

        except Exception as e:
            # 🔥 LAST RESORT: Catch ALL exceptions to prevent raw error output
            print(f"💥 Uncaught exception in handler: {e}")
            try:
                self.send_json_response(500, {"error": "Internal server error"})
            except:
                pass  # If sending fails, nothing we can do


# ========================
# ▶️ Start Server + Monitor
# ========================

def run_server():
    port = 8000
    try:
        server = HTTPServer(('localhost', port), handler)
        print(f"🚀 YouTube Transcript Server running on http://localhost:{port}")
        print(f"💡 Test: curl 'http://localhost:{port}?video_id=dQw4w9WgXcQ'")
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n🛑 Server stopped.")
    except Exception as e:
        print(f"🔥 Server failed to start: {e}")


if __name__ == "__main__":
    # Start health monitor in background
    monitor_thread = Thread(target=lambda: asyncio.run(health_monitor()), daemon=True)
    monitor_thread.start()

    # Give health check time to warm up
    time.sleep(2)

    # Start HTTP server
    run_server()
