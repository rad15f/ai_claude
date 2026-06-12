#!/usr/bin/env python3
"""
Fetch ~5,000 real human YouTube comments from public HuggingFace datasets.
Output: dataset/human_comments.csv

Usage:
    cd yt-bot-detector
    pip install datasets
    python3 training/fetch_human_comments.py

Tries datasets in order until we have enough rows:
  1. breadlicker45/youtube-comments-180k  — 187k unlabeled real comments
  2. AmaanP314/youtube-comment-sentiment  — 1M+ comments with sentiment labels
  3. breadlicker45/youtube-comments        — smaller backup set
"""

import csv
import random
import sys
from pathlib import Path

try:
    from datasets import load_dataset
except ImportError:
    sys.exit("Missing dependency: pip install datasets")

# ─── Config ──────────────────────────────────────────────────────────────────

TARGET = 4380  # match bot_comments.csv row count for balanced training
MIN_WORDS = 3
MAX_WORDS = 120  # strip very long essays — real YT comments rarely exceed this
OUTPUT_FILE = Path(__file__).parent.parent / "dataset" / "human_comments.csv"
FIELDNAMES = ["text", "label", "archetype", "word_count", "topic"]

# Datasets to try in order, each as (hf_id, config, split, text_col, label_col, human_label)
# label_col=None means all rows are assumed human
SOURCES = [
    ("breadlicker45/youtube-comments-180k", None, "train", "text",        None, None),
    ("AmaanP314/youtube-comment-sentiment", None, "train", "CommentText", None, None),
    # breadlicker45/youtube-comments has a malformed header — skipped
]

# ─── Helpers ─────────────────────────────────────────────────────────────────

def word_count(text: str) -> int:
    return len(text.split())

def is_clean(text: str) -> bool:
    wc = word_count(text)
    if wc < MIN_WORDS or wc > MAX_WORDS:
        return False
    # Skip obvious spam signals even in "human" datasets
    if any(kw in text.lower() for kw in ["http://", "https://", "subscribe to my", "check out my channel"]):
        return False
    return True

def load_comments_from_source(hf_id, config, split, text_col, label_col, human_label) -> list[str]:
    print(f"  Loading {hf_id} …", flush=True)
    try:
        ds = load_dataset(hf_id, config, split=split)
    except Exception as e:
        print(f"  ✗ Failed to load {hf_id}: {e}")
        return []

    # Show actual columns so we can fix mismatches
    first = next(iter(ds), None)
    if first is None:
        print(f"  ✗ Dataset is empty")
        return []
    actual_cols = list(first.keys())
    if text_col not in actual_cols:
        print(f"  ✗ Column '{text_col}' not found. Actual columns: {actual_cols}")
        return []

    comments = []
    for row in ds:
        # Filter by label if applicable
        if label_col is not None:
            if row.get(label_col) != human_label:
                continue

        text = (row.get(text_col) or "").strip()
        if is_clean(text):
            comments.append(text)

    print(f"  ✓ {len(comments)} clean comments from {hf_id}")
    return comments

# ─── Main ────────────────────────────────────────────────────────────────────

def main() -> None:
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    # Resume: count existing rows
    existing: set[str] = set()
    if OUTPUT_FILE.exists():
        with open(OUTPUT_FILE, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                existing.add(row["text"])
        print(f"Resuming — {len(existing)} rows already saved")

    if len(existing) >= TARGET:
        print(f"Already have {len(existing)} rows. Nothing to do.")
        return

    all_comments: list[str] = []

    for source in SOURCES:
        if len(all_comments) + len(existing) >= TARGET * 2:
            break  # plenty of candidates
        comments = load_comments_from_source(*source)
        all_comments.extend(comments)

    # Deduplicate across sources and against existing
    seen = set(existing)
    unique: list[str] = []
    for c in all_comments:
        if c not in seen:
            seen.add(c)
            unique.append(c)

    random.shuffle(unique)
    needed = TARGET - len(existing)
    selected = unique[:needed]

    if not selected:
        sys.exit("No new comments collected. Check dataset names or your internet connection.")

    # Build rows
    rows: list[dict] = []
    for text in selected:
        rows.append({
            "text":      text,
            "label":     0,          # 0 = human
            "archetype": "human",
            "word_count": word_count(text),
            "topic":     "",         # unknown without video metadata
        })

    # Write (append if file exists, else create with header)
    write_header = not OUTPUT_FILE.exists() or len(existing) == 0
    with open(OUTPUT_FILE, "a" if not write_header else "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        if write_header:
            writer.writeheader()
        writer.writerows(rows)

    total = len(existing) + len(rows)
    print(f"\nDone. {total} human comments → {OUTPUT_FILE}")
    if total < TARGET:
        print(f"  ⚠ Only {total}/{TARGET} collected — add more sources to SOURCES list if needed.")

if __name__ == "__main__":
    main()
