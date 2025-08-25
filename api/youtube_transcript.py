#!/usr/bin/env python3
"""
YouTube Transcript API Server (Async + Safe + No More 'Unexpected token A')
Uses aiohttp.web for full async compatibility.
"""

import asyncio
import aiohttp
from aiohttp import web
import json
import random
import time
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

# Cache
TRANSCRIPT_CACHE: Dict[str, Dict] = {}
CACHE_TTL = 600  # 10 minutes

# Proxy health
HEALTHY_PROXIES = PROXY_LIST.copy()
HEALTH_CHECK_INTERVAL = 60
PROXY_TIMEOUT = 10.0

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15"
]

TRANSCRIPT_URL = "https://www.youtube.com/api/timedtext?video_id={video_id}&fmt=json3&lang=en"


# ========================
# 🧪 Proxy Health Checker
# ========================

async def is_proxy_healthy(proxy: str) -> bool:
    url = TRANSCRIPT_URL.format(video_id="dQw4w9WgXcQ")
    timeout = aiohttp.ClientTimeout(total=PROXY_TIMEOUT)
    headers = {"User-Agent": random.choice(USER_AGENTS)}
    connector = aiohttp.TCPConnector(ssl=False)
    try:
        async with aiohttp.ClientSession(connector=connector, timeout=timeout) as session:
            async with session.get(url, proxy=proxy, headers=headers) as resp:
                return resp.status == 200
    except Exception:
        return False


async def health_monitor():
    global HEALTHY_PROXIES
    print("[Health Monitor] Starting...")
    while True:
        print("[Health Monitor] Checking...")
        tasks = [is_proxy_healthy(proxy) for proxy in PROXY_LIST]
        results = await asyncio.gather(*tasks)
        HEALTHY_PROXIES[:] = [p for p, ok in zip(PROXY_LIST, results) if ok]
        print(f"[Health Monitor] ✅ {len(HEALTHY_PROXIES)} proxies healthy")
        await asyncio.sleep(HEALTH_CHECK_INTERVAL)


# ========================
# 🌐 Transcript Fetcher
# ========================

async def fetch_transcript_from_proxy(video_id: str, proxy: str) -> Tuple[Optional[str], Optional[str]]:
    url = TRANSCRIPT_URL.format(video_id=video_id)
    timeout = aiohttp.ClientTimeout(total=PROXY_TIMEOUT)
    headers = {"User-Agent": random.choice(USER_AGENTS)}
    connector = aiohttp.TCPConnector(ssl=False)
    try:
        async with aiohttp.ClientSession(connector=connector, timeout=timeout) as session:
            async with session.get(url, proxy=proxy, headers=headers) as response:
                if response.status != 200:
                    body = await response.text()
                    return None, f"HTTP {response.status}: {body[:100]}"
                try:
                    data = await response.json()
                    parts = []
                    for ev in data.get("events", []):
                        if "segs" in ev:
                            for seg in ev["segs"]:
                                parts.append(seg.get("utf8", ""))
                    return " ".join(parts).strip(), None
                except Exception as e:
                    body = await response.text()
                    return None, f"Parse error: {e} | Body: {body[:100]}"
    except Exception as e:
        return None, f"{type(e).__name__}: {e}"


async def fetch_transcript_with_proxies(video_id: str) -> Dict:
    if not HEALTHY_PROXIES:
        return {"success": False, "error": "No proxies available"}
    tasks = [fetch_transcript_from_proxy(video_id, p) for p in random.sample(HEALTHY_PROXIES, min(6, len(HEALTHY_PROXIES)))]
    done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    for task in done:
        transcript, error = await task
        if transcript:
            return {"success": True, "transcript": transcript}
    errors = [await t for t in done]
    return {"success": False, "error": errors[-1][1] if errors else "Unknown"}


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
# 🖥️ Async HTTP Routes
# ========================

async def get_transcript(request):
    try:
        video_id = request.query.get("video_id")
        if not video_id:
            return web.json_response({"error": "video_id required"}, status=400)

        video_id = video_id.split("&")[0][:11]
        if len(video_id) != 11:
            return web.json_response({"error": "Invalid video_id"}, status=400)

        # Cache check
        cached = get_cached(video_id)
        if cached:
            return web.json_response({
                "video_id": video_id,
                "transcript": cached,
                "source": "cache"
            })

        # Fetch
        result = await fetch_transcript_with_proxies(video_id)
        if result["success"]:
            cache_set(video_id, result["transcript"])
            return web.json_response({
                "video_id": video_id,
                "transcript": result["transcript"],
                "source": "live"
            })
        else:
            return web.json_response({
                "error": "Fetch failed",
                "details": result["error"]
            }, status=500)

    except Exception as e:
        print(f"Handler error: {e}")
        return web.json_response({"error": "Internal error"}, status=500)


# ========================
# ▶️ Start Server
# ========================

async def start_server():
    app = web.Application()
    app.router.add_get("/", get_transcript)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, 'localhost', 8000)
    await site.start()
    print("🚀 Server running on http://localhost:8000")
    print("💡 Test: curl 'http://localhost:8000?video_id=dQw4w9WgXcQ'")


if __name__ == "__main__":
    # Start health monitor
    monitor_thread = Thread(target=lambda: asyncio.run(health_monitor()), daemon=True)
    monitor_thread.start()

    # Start async server
    asyncio.run(start_server())
