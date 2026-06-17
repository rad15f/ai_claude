#!/usr/bin/env python3
"""
Extract confirmed bot channel IDs from the scrape cache.

Cross-references real_bot_comments.csv (confirmed bot texts) with
scrape_comments_cache.jsonl (raw comments + author channel IDs) to produce
a list of ground-truth bot accounts for evaluating the account signal.

Usage:
    cd yt-bot-detector
    python3 training/extract_bot_accounts.py

Output:
    dataset/confirmed_bot_channel_ids.json
"""

import csv
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

DATASET_DIR   = Path(__file__).parent.parent / "dataset"
BOT_CSV       = DATASET_DIR / "real_bot_comments.csv"
CACHE_JSONL   = DATASET_DIR / "scrape_comments_cache.jsonl"
OUTPUT_FILE   = DATASET_DIR / "confirmed_bot_channel_ids.json"


def normalize(text: str) -> str:
    t = text.lower().strip()
    t = re.sub(r'\s+', ' ', t)
    t = re.sub(r'[.!?,;]+$', '', t)
    return t


def main() -> None:
    if not BOT_CSV.exists():
        sys.exit(f"Missing: {BOT_CSV}\nRun scrape_real_bots.py first.")
    if not CACHE_JSONL.exists():
        sys.exit(f"Missing: {CACHE_JSONL}\nRun scrape_real_bots.py first.")

    # Load confirmed bot texts → normalized keys
    bot_norm_keys: set[str] = set()
    with open(BOT_CSV, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            bot_norm_keys.add(normalize(row["text"]))

    print(f"Confirmed bot text patterns: {len(bot_norm_keys)}")

    # Scan cache for authors behind those texts
    # norm_key → set of channel IDs
    text_to_authors: dict[str, set[str]] = defaultdict(set)
    total_lines = 0

    with open(CACHE_JSONL, encoding="utf-8") as f:
        for line in f:
            total_lines += 1
            c = json.loads(line)
            key = normalize(c.get("text", ""))
            if key in bot_norm_keys:
                author = c.get("author", "")
                if author:
                    text_to_authors[key].add(author)

    print(f"Scanned {total_lines:,} cached comments")

    # Collect all unique confirmed-bot channel IDs
    all_bot_channel_ids: set[str] = set()
    for authors in text_to_authors.values():
        all_bot_channel_ids.update(authors)

    # Build output: channel_id → list of bot texts they posted
    channel_to_texts: dict[str, list[str]] = defaultdict(list)
    with open(CACHE_JSONL, encoding="utf-8") as f:
        for line in f:
            c = json.loads(line)
            author = c.get("author", "")
            if author and author in all_bot_channel_ids:
                key = normalize(c.get("text", ""))
                if key in bot_norm_keys:
                    channel_to_texts[author].append(c["text"])

    output = {
        "total_confirmed_bot_accounts": len(all_bot_channel_ids),
        "source": "cross-video duplicate detection (≥3 videos, ≥2 authors)",
        "accounts": {
            cid: {
                "confirmed_bot_texts": list(set(texts)),
                "confirmed_bot_text_count": len(set(texts)),
            }
            for cid, texts in sorted(
                channel_to_texts.items(),
                key=lambda x: len(set(x[1])),
                reverse=True,
            )
        },
    }

    OUTPUT_FILE.write_text(json.dumps(output, indent=2, ensure_ascii=False))

    print(f"\n✓ {len(all_bot_channel_ids)} confirmed bot channel IDs → {OUTPUT_FILE}")
    print(f"\nTop 20 most prolific bot accounts:")
    print(f"  {'Channel ID':<35}  Bot texts posted")
    print("  " + "─" * 55)
    for cid, data in list(output["accounts"].items())[:20]:
        print(f"  {cid:<35}  {data['confirmed_bot_text_count']}")

    print(f"\nNext steps:")
    print(f"  Run these channel IDs through the extension's account signal")
    print(f"  and check what fraction score ≥ 0.5 on account signal alone.")


if __name__ == "__main__":
    main()
