#!/usr/bin/env python3
"""
Scrape real bot comments from YouTube using cross-video duplicate detection.

Strategy (Option C):
  1. Pull comments from high-spam videos across diverse categories
  2. Find comments posted by multiple DIFFERENT accounts across 3+ videos
  3. Those are definitionally bots — no human writes the same comment on 3+ videos
  4. Save confirmed bot comments to dataset/real_bot_comments.csv

Usage:
    cd yt-bot-detector
    YOUTUBE_API_KEY=<your-key> python3 training/scrape_real_bots.py

Requirements:
    pip install requests
"""

import csv
import json
import os
import re
import sys
import time
import random
from collections import defaultdict
from pathlib import Path

try:
    import requests
except ImportError:
    sys.exit("Missing dependency: pip install requests")

# ─── Config ──────────────────────────────────────────────────────────────────

API_KEY    = os.environ.get("YOUTUBE_API_KEY", "")
YT_BASE    = "https://www.googleapis.com/youtube/v3"
OUTPUT_DIR = Path(__file__).parent.parent / "dataset"
OUTPUT_FILE  = OUTPUT_DIR / "real_bot_comments.csv"
VIDEO_CACHE  = OUTPUT_DIR / "scrape_video_ids.json"       # avoid re-spending search quota
COMMENT_CACHE = OUTPUT_DIR / "scrape_comments_cache.jsonl" # checkpoint during fetch
ALL_PATTERNS_FILE = OUTPUT_DIR / "all_confirmed_bot_patterns.json"  # pre-filter, includes engagement bots
FIELDNAMES   = ["text", "label", "archetype", "word_count", "topic",
                "video_count", "author_count"]

# A comment must appear in this many different videos AND from this many different
# accounts to be labeled bot. Both conditions must be true.
MIN_VIDEO_APPEARANCES  = 3
MIN_DISTINCT_AUTHORS   = 2   # rules out one person copy-pasting across their own comments

# Comments per video page (max 100)
PAGE_SIZE = 100

# Max pages per video (100 × 10 = 1,000 comments per video)
MAX_PAGES_PER_VIDEO = 10

# Max videos per search query (YouTube's hard cap on maxResults is 50)
VIDEOS_PER_QUERY = 50

# ─── Search queries — diverse categories, all known to attract bot farms ─────

SEARCH_QUERIES = [
    # Crypto / finance (highest bot density)
    "crypto trading signals 2025",
    "bitcoin price prediction today",
    "best altcoins to buy now",
    "passive income crypto",
    "ethereum price analysis",
    "day trading crypto strategy",
    "bitcoin bull run analysis",
    "how to buy solana beginner",

    # Make money online / MLM
    "how to make money online fast",
    "passive income ideas 2025",
    "how to make money from home",
    "dropshipping tutorial beginners",
    "affiliate marketing for beginners",
    "how to make $1000 a day online",
    "network marketing success tips",

    # Self-help / motivation (fake relatability bots common here)
    "how to be more productive",
    "morning routine successful people",
    "how to overcome anxiety",
    "self improvement motivation",
    "law of attraction success story",

    # Fitness / weight loss (supplement spam bots)
    "how to lose weight fast",
    "best diet plan 2025",
    "home workout routine beginner",
    "intermittent fasting results",
    "fat burning workout",

    # Music / celebrity (engagement farm bots)
    "best music mix 2025",
    "viral music video reaction",
    "top hits playlist 2025",

    # Gaming (follow-for-follow bots)
    "how to get better at fortnite",
    "best gaming setup 2025",
    "minecraft survival tips",

    # Real estate / investing
    "real estate investing for beginners",
    "how to flip houses 2025",
    "stock market for beginners",

    # Tech / gadgets
    "best smartphone 2025 review",
    "iphone vs samsung comparison",

    # Beauty / lifestyle
    "skincare routine for beginners",
    "makeup tutorial for beginners",
    "glow up transformation",

    # Crypto pump / get-rich-quick (highest distinctive bot density per data scientist)
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

    # Giveaway / prize spam
    "cash giveaway 2025",
    "iphone giveaway winner",
    "crypto giveaway legit",
    "elon musk bitcoin giveaway",
    "win $1000 giveaway",

    # Forex / trading signals
    "forex trading signals free",
    "best forex strategy 2025",
    "copy trading results",
    "forex profit daily",
    "trading bot results 2025",

    # MLM / network marketing
    "amway mlm truth",
    "herbalife weight loss results",
    "network marketing income proof",
    "mlm success story",

    # Weight loss / supplements (fake testimonials)
    "weight loss transformation 30 days",
    "keto diet results before after",
    "best weight loss supplement 2025",
    "apple cider vinegar weight loss",
]

# ─── Filters ──────────────────────────────────────────────────────────────────
#
# Engagement farm bots post generic positive phrases ("Thank you so much",
# "Really appreciate this upload") across hundreds of videos. Cross-video
# detection correctly flags them, but their TEXT is identical to what real
# humans write. Including them in training data would teach the model that
# normal compliments = bot. We keep only comments where the TEXT ITSELF
# contains a distinguishable bot signal.

# Require either: text has a substantive signal below, OR word count ≥ this.
# Short praise can't be a training signal regardless of how many accounts post it.
MIN_WORDS_WITHOUT_SIGNAL = 12

# Patterns that make a comment text-distinctively bot-like even if short.
_URL_RE      = re.compile(r'https?://', re.I)
_TICKER_RE   = re.compile(r'\$[A-Z0-9]{2,12}\$\$?')
_MONEY_RE    = re.compile(r'\$[\d,.]+|\b\d+[kK]\s*(biweekly|a\s*week|monthly|daily|per\s*day)\b', re.I)
_TEMPLATE_RE = re.compile(
    r'(i\s+(make|earn|made|earned)\s+\$'
    r'|earn\s+\$'
    r'|making\s+\$'
    r'|retired\s+at\s+\d+'
    r'|laid\s+off\s+from'
    r'|truck\s+driver'
    r'|trading\s+signals?'
    r'|crypto\s+group'
    r'|whatsapp|telegram|t\.me/'
    r'|signalpeak|linktr\.ee'
    r')',
    re.I,
)

def has_textual_bot_signal(text: str) -> bool:
    """Return True if the comment text itself contains a recognisable bot pattern."""
    return bool(
        _URL_RE.search(text)
        or _TICKER_RE.search(text)
        or _MONEY_RE.search(text)
        or _TEMPLATE_RE.search(text)
    )


# ─── Text normalization (dedup key only — original text is saved) ─────────────

def normalize(text: str) -> str:
    t = text.lower().strip()
    t = re.sub(r'\s+', ' ', t)
    t = re.sub(r'[.!?,;]+$', '', t)
    return t

# ─── API helpers ─────────────────────────────────────────────────────────────

def api_get(endpoint: str, params: dict):
    params["key"] = API_KEY
    try:
        res = requests.get(f"{YT_BASE}/{endpoint}", params=params, timeout=15)
        if res.status_code == 403:
            data = res.json()
            reason = data.get("error", {}).get("errors", [{}])[0].get("reason", "unknown")
            if reason == "quotaExceeded":
                sys.exit("✗ YouTube API quota exhausted. Try again tomorrow.")
            print(f"  ✗ 403 Forbidden ({reason})")
            return None
        if not res.ok:
            print(f"  ✗ HTTP {res.status_code} for {endpoint}")
            return None
        return res.json()
    except requests.RequestException as e:
        print(f"  ✗ Request error: {e}")
        return None


def search_videos(query: str, order: str = "date") -> list[str]:
    """Return video IDs for a search query. Uses time order to get unfiltered firehose."""
    data = api_get("search", {
        "part": "id",
        "q": query,
        "type": "video",
        "order": order,
        "maxResults": VIDEOS_PER_QUERY,
        "relevanceLanguage": "en",
        "safeSearch": "none",
    })
    if not data:
        return []
    return [
        item["id"]["videoId"]
        for item in data.get("items", [])
        if "videoId" in item.get("id", {})
    ]


def fetch_comments_for_video(video_id: str) -> list[dict]:
    """Fetch up to MAX_PAGES_PER_VIDEO × PAGE_SIZE comments from one video."""
    comments = []
    page_token = None

    for _ in range(MAX_PAGES_PER_VIDEO):
        params = {
            "part": "snippet",
            "videoId": video_id,
            "maxResults": PAGE_SIZE,
            "textFormat": "plainText",
            "order": "time",  # chronological = unfiltered by YouTube's relevance ranker
        }
        if page_token:
            params["pageToken"] = page_token

        data = api_get("commentThreads", params)
        if not data:
            break

        for item in data.get("items", []):
            snippet = item.get("snippet", {}).get("topLevelComment", {}).get("snippet", {})
            text = snippet.get("textDisplay", "").strip()
            author = snippet.get("authorChannelId", {}).get("value", "")
            published_at = snippet.get("publishedAt", "")
            if text:
                comments.append({
                    "text":         text,
                    "video_id":     video_id,
                    "author":       author,
                    "published_at": published_at,
                })

        page_token = data.get("nextPageToken")
        if not page_token:
            break

        time.sleep(0.3)

    return comments

# ─── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    if not API_KEY:
        sys.exit("Set YOUTUBE_API_KEY environment variable first.")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # ── Step 1: collect video IDs (cached to avoid re-spending search quota) ──
    if VIDEO_CACHE.exists():
        video_ids = json.loads(VIDEO_CACHE.read_text())
        print(f"Step 1: Loaded {len(video_ids)} video IDs from cache ({VIDEO_CACHE.name})")
    else:
        print("Step 1: Searching for high-spam videos …")
        print("        (search.list costs 100 units/call — results cached after this run)\n")
        seen_ids: set[str] = set()
        video_ids: list[str] = []

        for query in SEARCH_QUERIES:
            # Pull with both date and relevance ordering to cover fresh + established spam
            for order in ("date", "relevance"):
                ids = search_videos(query, order=order)
                new = [v for v in ids if v not in seen_ids]
                seen_ids.update(new)
                video_ids.extend(new)
            print(f"  '{query}' → {len(video_ids)} videos total")
            time.sleep(0.5)

        random.shuffle(video_ids)
        VIDEO_CACHE.write_text(json.dumps(video_ids))
        print(f"\n  {len(video_ids)} unique videos cached → {VIDEO_CACHE.name}\n")

    # ── Step 2: fetch comments (checkpointed to .jsonl) ──────────────────────
    print("Step 2: Fetching comments …")

    # Load already-fetched video IDs from checkpoint
    fetched_video_ids: set[str] = set()
    all_comments: list[dict] = []

    if COMMENT_CACHE.exists():
        with open(COMMENT_CACHE, encoding="utf-8") as f:
            for line in f:
                c = json.loads(line)
                all_comments.append(c)
                fetched_video_ids.add(c["video_id"])
        print(f"  Resumed from checkpoint — {len(fetched_video_ids)} videos already fetched, "
              f"{len(all_comments)} comments loaded\n")

    remaining = [v for v in video_ids if v not in fetched_video_ids]

    with open(COMMENT_CACHE, "a", encoding="utf-8") as cache_f:
        for i, vid in enumerate(remaining, 1):
            comments = fetch_comments_for_video(vid)
            for c in comments:
                cache_f.write(json.dumps(c) + "\n")
            all_comments.extend(comments)
            total_done = len(fetched_video_ids) + i
            print(f"  [{total_done}/{len(video_ids)}] {vid} → {len(comments)} comments  "
                  f"(total: {len(all_comments)})")
            time.sleep(0.5)

    print(f"\n  {len(all_comments)} total comments collected")

    # ── Step 3: cross-video duplicate detection with author diversity ─────────
    print(f"\nStep 3: Finding comments across ≥ {MIN_VIDEO_APPEARANCES} videos "
          f"from ≥ {MIN_DISTINCT_AUTHORS} distinct authors …")

    # Use normalized text as dedup key; track original text for saving
    norm_to_originals: dict[str, list[str]]  = defaultdict(list)
    norm_to_videos:    dict[str, set[str]]   = defaultdict(set)
    norm_to_authors:   dict[str, set[str]]   = defaultdict(set)

    for c in all_comments:
        key = normalize(c["text"])
        norm_to_originals[key].append(c["text"])
        norm_to_videos[key].add(c["video_id"])
        norm_to_authors[key].add(c["author"])

    bot_keys = {
        key for key in norm_to_videos
        if len(norm_to_videos[key]) >= MIN_VIDEO_APPEARANCES
        and len(norm_to_authors[key]) >= MIN_DISTINCT_AUTHORS
    }

    print(f"  {len(bot_keys)} unique comment patterns confirmed as bot")

    # Dump the FULL pre-filter pattern set (including engagement filler that gets
    # dropped from training data below). This is ground truth for account/crossComment
    # signal evaluation — those signals don't care whether the text is learnable.
    all_patterns = {
        key: {
            "video_count":  len(norm_to_videos[key]),
            "author_count": len(norm_to_authors[key]),
            "authors":      sorted(norm_to_authors[key]),
            "sample_text":  max(set(norm_to_originals[key]), key=norm_to_originals[key].count),
        }
        for key in bot_keys
    }
    ALL_PATTERNS_FILE.write_text(json.dumps(all_patterns, indent=2, ensure_ascii=False))
    print(f"  All {len(bot_keys)} confirmed patterns (pre-filter) → {ALL_PATTERNS_FILE.name}")

    if not bot_keys:
        print(f"\n  ⚠ No bot comments found. Diagnostic — top 20 most-duplicated patterns:")
        top = sorted(norm_to_videos.items(), key=lambda x: len(x[1]), reverse=True)[:20]
        for key, vids in top:
            authors = len(norm_to_authors[key])
            print(f"    {len(vids)} videos / {authors} authors: {repr(key[:80])}")
        return

    # ── Step 4: build rows ────────────────────────────────────────────────────
    rows: list[dict] = []
    skipped_generic = 0
    for key in bot_keys:
        # Use the most common original text form
        original = max(set(norm_to_originals[key]), key=norm_to_originals[key].count)
        wc = len(original.split())
        if wc < 4:
            continue
        # Skip pure emoji / symbol strings
        if re.fullmatch(r'[\W\s]+', original, re.UNICODE):
            continue
        # Drop short generic praise — text indistinguishable from real humans
        if wc < MIN_WORDS_WITHOUT_SIGNAL and not has_textual_bot_signal(original):
            skipped_generic += 1
            continue
        rows.append({
            "text":         original,
            "label":        1,
            "archetype":    "real_bot_cross_video",
            "word_count":   wc,
            "topic":        "",
            "video_count":  len(norm_to_videos[key]),
            "author_count": len(norm_to_authors[key]),
        })

    # Sort by confidence (most videos × most authors first)
    rows.sort(key=lambda r: (r["video_count"], r["author_count"]), reverse=True)

    # ── Step 5: save ──────────────────────────────────────────────────────────
    with open(OUTPUT_FILE, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(rows)

    print(f"\n✓ {len(rows)} real bot comments → {OUTPUT_FILE}")
    if skipped_generic:
        print(f"  (skipped {skipped_generic} short generic phrases — text indistinguishable from human)")

    # ── Step 6: spot-check printout (top 50) ─────────────────────────────────
    print(f"\nTop 50 confirmed bot comments (manual spot-check before merging):")
    print(f"{'Videos':>6}  {'Authors':>7}  Comment")
    print("─" * 80)
    for r in rows[:50]:
        preview = repr(r["text"][:70])
        print(f"  {r['video_count']:>4}v  {r['author_count']:>6}a  {preview}")

    print(f"\nNext steps:")
    print(f"  1. Manually scan the top 50 above for false positives")
    print(f"  2. Delete scrape_comments_cache.jsonl if you want a fresh fetch next run")
    print(f"  3. Merge into training data: python3 training/merge_dataset.py")


if __name__ == "__main__":
    main()
