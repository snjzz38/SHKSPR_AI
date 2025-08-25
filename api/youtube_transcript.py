#!/usr/bin/env python3
"""
Fast, Async YouTube Transcript API
- Concurrent proxy testing
- Caching
- Direct YouTube API calls (no youtube-transcript-api)
- Always returns valid JSON
"""

import asyncio
import aiohttp
import json
import random
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs
from threading import Thread
from typing import Dict, Optional

# ========================
# 🔧 CONFIGURATION
# ========================

# Fast, HTTPS-enabled proxies (North America)
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

# Cache: video_id -> { text, time }
TRANSCRIPT_CACHE: Dict[str, Dict] = {}
CACHE_TTL = 600  # 10 minutes

# Timeout
PROXY_TIMEOUT = 10.0

# User-Agent rotation
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"
]

# YouTube Transcript API URL
TRANSCRIPT_URL = "https://www.youtube.com/api/timedtext?video_id={video_id}&fmt=json3&lang=en"


# ========================
# 🌐 Fetch Transcript
# ========================

async def fetch_with_proxy(video_id: str, proxy: str) -> Optional[str]:
    url = TRANSCRIPT_URL.format(video_id=video_id)
    timeout = aiohttp.ClientTimeout(total=PROXY_TIMEOUT)
    headers = {"User-Agent": random.choice(USER_AGENTS)}
    connector = aiohttp.TCPConnector(ssl=False)  # Avoid SSL issues

    try:
        async with aiohttp.ClientSession(connector=connector, timeout=timeout) as session:
            async with session.get(url, proxy=proxy, headers=headers) as response:
                if response.status != 200:
                    return None
                try:
                    data = await response.json()
                    parts = []
                    for event in data.get("events", []):
                        if "segs" in event:
                            for seg in event["segs"]:
                                parts.append(seg.get("utf8", ""))
                    return " ".join(parts).strip()
                except Exception:
                    return None
    except Exception:
        return None


async def fetch_transcript(video_id: str, max_concurrent: int = 6) -> Optional[str]:
    """Try multiple proxies concurrently."""
    candidates = random.sample(PROXY_LIST, min(max_concurrent, len(PROXY_LIST)))
    tasks = [fetch_with_proxy(video_id, p) for p in candidates]
    done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    for task in done:
        result = await task
        if result:
            return result
    return None


# ========================
# 📦 Caching
# ========================

def get_cached(video_id: str) -> Optional[str]:
    item = TRANSCRIPT_CACHE.get(video_id)
    if item and time.time() - item["time"] < CACHE_TTL:
        return item["text"]
    TRANSCRIPT_CACHE.pop(video_id, None)
    return None


def cache_set(video_id: str, text: str):
    TRANSCRIPT_CACHE[video_id] = {"text": text, "time": time.time()}


# ========================
# 🖥️ HTTP Handler
# ========================

class handler(BaseHTTPRequestHandler):
    def send_json(self, status: int, data: dict):
        self.send_response(status)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        try:
            body = json.dumps(data)
            self.wfile.write(body.encode('utf-8'))
        except Exception:
            pass  # Don't let write errors crash server

    def do_GET(self):
        try:
            # Parse video_id
            query = urlparse(self.path)
            video_id = parse_qs(query.query).get("video_id", [None])[0]
            if not video_id:
                return self.send_json(400, {"error": "video_id parameter is required"})
            video_id = video_id.strip()[:11]
            if len(video_id) != 11:
                return self.send_json(400, {"error": "Invalid YouTube video ID"})

            # Check cache
            cached = get_cached(video_id)
            if cached:
                return self.send_json(200, {"transcript": cached})

            # Fetch live
            try:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                transcript = loop.run_until_complete(fetch_transcript(video_id))
                loop.close()
            except Exception as e:
                print(f"Async error: {e}")
                return self.send_json(500, {"error": "Internal error"})

            if transcript:
                cache_set(video_id, transcript)
                return self.send_json(200, {"transcript": transcript})
            else:
                return self.send_json(500, {"error": "Failed to fetch transcript"})

        except Exception as e:
            print(f"Handler error: {e}")
            self.send_json(500, {"error": "Internal server error"})


# ========================
# ▶️ Run Server
# ========================

def run_server():
    port = 8000
    server = HTTPServer(('localhost', port), handler)
    print(f"🚀 Transcript API running on http://localhost:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n🛑 Stopped.")


if __name__ == "__main__":
    run_server()
