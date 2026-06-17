#!/usr/bin/env python3
"""
Targeted re-fetch: pulls comments (with published_at this time) only for the
108 videos touched by the 120 accounts sampled in compare_bot_vs_normal_accounts.py.

The original scrape_comments_cache.jsonl predates the published_at field, so
posting-frequency analysis has no data. Re-fetching all 376 videos would waste
quota — this only re-fetches the videos our sample actually needs.

Usage:
    cd yt-bot-detector
    YOUTUBE_API_KEY=<key> python3 training/refetch_timestamps_for_sample.py

Output:
    dataset/sample_accounts_timestamped.jsonl
"""

import json
import os
import random
import sys
import time
from pathlib import Path

try:
    import requests
except ImportError:
    sys.exit("Missing dependency: pip install requests")

API_KEY      = os.environ.get("YOUTUBE_API_KEY", "")
YT_BASE      = "https://www.googleapis.com/youtube/v3"
DATASET_DIR  = Path(__file__).parent.parent / "dataset"
PATTERNS_FILE = DATASET_DIR / "all_confirmed_bot_patterns.json"
CACHE_JSONL  = DATASET_DIR / "scrape_comments_cache.jsonl"
OUTPUT_FILE  = DATASET_DIR / "sample_accounts_timestamped.jsonl"

SAMPLE_SIZE = 60
PAGE_SIZE = 100
MAX_PAGES_PER_VIDEO = 10


def api_get(endpoint: str, params: dict):
    params["key"] = API_KEY
    res = requests.get(f"{YT_BASE}/{endpoint}", params=params, timeout=15)
    if res.status_code == 403:
        data = res.json()
        reason = data.get("error", {}).get("errors", [{}])[0].get("reason", "unknown")
        if reason == "quotaExceeded":
            sys.exit("YouTube API quota exhausted.")
        print(f"  403 ({reason}) for {params.get('videoId', '')}")
        return None
    if not res.ok:
        print(f"  HTTP {res.status_code}")
        return None
    return res.json()


def fetch_comments_for_video(video_id: str) -> list[dict]:
    comments = []
    page_token = None
    for _ in range(MAX_PAGES_PER_VIDEO):
        params = {
            "part": "snippet",
            "videoId": video_id,
            "maxResults": PAGE_SIZE,
            "textFormat": "plainText",
            "order": "time",
        }
        if page_token:
            params["pageToken"] = page_token
        data = api_get("commentThreads", params)
        if not data:
            break
        for item in data.get("items", []):
            snippet = item.get("snippet", {}).get("topLevelComment", {}).get("snippet", {})
            comments.append({
                "text":         snippet.get("textDisplay", "").strip(),
                "video_id":     video_id,
                "author":       snippet.get("authorChannelId", {}).get("value", ""),
                "published_at": snippet.get("publishedAt", ""),
            })
        page_token = data.get("nextPageToken")
        if not page_token:
            break
        time.sleep(0.3)
    return comments


def main() -> None:
    if not API_KEY:
        sys.exit("Set YOUTUBE_API_KEY environment variable.")

    patterns = json.loads(PATTERNS_FILE.read_text())
    bot_accounts = set()
    for data in patterns.values():
        bot_accounts.update(a for a in data["authors"] if a)

    random.seed(42)
    bot_sample = set(random.sample(sorted(bot_accounts), min(SAMPLE_SIZE, len(bot_accounts))))

    all_authors = set()
    author_to_videos: dict[str, set] = {}
    with open(CACHE_JSONL, encoding="utf-8") as f:
        for line in f:
            c = json.loads(line)
            a = c.get("author", "")
            if a:
                all_authors.add(a)
                author_to_videos.setdefault(a, set()).add(c["video_id"])

    normal_pool = all_authors - bot_accounts
    random.seed(42)
    normal_sample = set(random.sample(sorted(normal_pool), min(SAMPLE_SIZE, len(normal_pool))))

    target_accounts = bot_sample | normal_sample
    target_videos: set = set()
    for a in target_accounts:
        target_videos.update(author_to_videos.get(a, set()))

    print(f"Target accounts: {len(target_accounts)} ({len(bot_sample)} bot + {len(normal_sample)} normal)")
    print(f"Videos to re-fetch: {len(target_videos)}\n")

    all_timestamped: list[dict] = []
    for i, vid in enumerate(sorted(target_videos), 1):
        comments = fetch_comments_for_video(vid)
        # Only keep comments from our target accounts — discard the rest immediately
        relevant = [c for c in comments if c["author"] in target_accounts]
        all_timestamped.extend(relevant)
        print(f"  [{i}/{len(target_videos)}] {vid} → {len(comments)} fetched, {len(relevant)} relevant")
        time.sleep(0.3)

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        for c in all_timestamped:
            f.write(json.dumps(c) + "\n")

    print(f"\n✓ {len(all_timestamped)} timestamped comments from target accounts → {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
