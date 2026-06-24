#!/usr/bin/env python3
"""
Incremental video discovery: searches ONLY the newer crypto/pump/giveaway/forex/MLM
queries (richest in textually-distinctive bot patterns per data scientist feedback)
and merges newly found video IDs into the existing scrape_video_ids.json cache.

Does NOT re-search the original 40 queries — those videos are already cached.
Does NOT fetch comments — run scrape_real_bots.py afterward; its existing resume
logic will only fetch comments for the newly added video IDs.

Usage:
    cd yt-bot-detector
    YOUTUBE_API_KEY=<key> python3 training/find_more_videos.py

Quota cost: 35 queries × 2 orders × 100 units = 7,000 units (search.list only).
"""

import json
import os
import sys
import time
from pathlib import Path

try:
    import requests
except ImportError:
    sys.exit("Missing dependency: pip install requests")

API_KEY     = os.environ.get("YOUTUBE_API_KEY", "")
YT_BASE     = "https://www.googleapis.com/youtube/v3"
DATASET_DIR = Path(__file__).parent.parent / "dataset"
VIDEO_CACHE = DATASET_DIR / "scrape_video_ids.json"
VIDEOS_PER_QUERY = 50  # YouTube's hard cap on maxResults

# Only the newer, narrower queries — richest in distinctive bot text per
# data scientist feedback: relevance-sort hides spam most in these niches.
NEW_QUERIES = [
    "altcoin season 2025 gains",
    "100x crypto gem 2025",
    "crypto millionaire story",
    "next bitcoin 2025 prediction",
    "shiba inu price prediction 2025",
    "dogecoin next rally",
    "solana 1000 dollars prediction",
    "crypto presale 2025",
    "best meme coins to buy",
    "how i made $100k crypto",
    "cash giveaway 2025",
    "iphone giveaway winner",
    "crypto giveaway legit",
    "elon musk bitcoin giveaway",
    "win $1000 giveaway",
    "forex trading signals free",
    "best forex strategy 2025",
    "copy trading results",
    "forex profit daily",
    "trading bot results 2025",
    "amway mlm truth",
    "herbalife weight loss results",
    "network marketing income proof",
    "mlm success story",
    "weight loss transformation 30 days",
    "keto diet results before after",
    "best weight loss supplement 2025",
    "apple cider vinegar weight loss",
]


def search_videos(query: str, order: str) -> list[str]:
    res = requests.get(f"{YT_BASE}/search", params={
        "part": "id",
        "q": query,
        "type": "video",
        "order": order,
        "maxResults": VIDEOS_PER_QUERY,
        "relevanceLanguage": "en",
        "safeSearch": "none",
        "key": API_KEY,
    }, timeout=15)
    if res.status_code == 403:
        data = res.json()
        reason = data.get("error", {}).get("errors", [{}])[0].get("reason", "unknown")
        if reason == "quotaExceeded":
            sys.exit("YouTube API quota exhausted.")
        print(f"  403 ({reason}) for '{query}'")
        return []
    if not res.ok:
        print(f"  HTTP {res.status_code} for '{query}'")
        return []
    data = res.json()
    return [item["id"]["videoId"] for item in data.get("items", []) if "videoId" in item.get("id", {})]


def main() -> None:
    if not API_KEY:
        sys.exit("Set YOUTUBE_API_KEY environment variable.")

    existing_ids: list[str] = []
    if VIDEO_CACHE.exists():
        existing_ids = json.loads(VIDEO_CACHE.read_text())
    existing_set = set(existing_ids)
    print(f"Existing cached videos: {len(existing_ids)}")

    new_ids: list[str] = []
    for query in NEW_QUERIES:
        for order in ("date", "relevance"):
            ids = search_videos(query, order)
            fresh = [v for v in ids if v not in existing_set and v not in new_ids]
            new_ids.extend(fresh)
        print(f"  '{query}' → {len(new_ids)} new videos so far")
        time.sleep(0.3)

    merged = existing_ids + new_ids
    VIDEO_CACHE.write_text(json.dumps(merged))

    print(f"\n✓ Added {len(new_ids)} new videos → {len(merged)} total → {VIDEO_CACHE}")
    print(f"\nNext: run scrape_real_bots.py — it will skip the {len(existing_ids)} already-fetched")
    print(f"videos and only fetch comments for the {len(new_ids)} new ones.")


if __name__ == "__main__":
    main()
