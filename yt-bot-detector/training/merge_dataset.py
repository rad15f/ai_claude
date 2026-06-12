#!/usr/bin/env python3
"""
Merge bot_comments.csv + human_comments.csv → dataset/training_data.csv

Usage:
    cd yt-bot-detector
    python3 training/merge_dataset.py
"""

import csv
import random
from pathlib import Path

DATASET_DIR = Path(__file__).parent.parent / "dataset"
BOT_FILE    = DATASET_DIR / "bot_comments.csv"
HUMAN_FILE  = DATASET_DIR / "human_comments.csv"
OUTPUT_FILE = DATASET_DIR / "training_data.csv"
FIELDNAMES  = ["text", "label", "archetype", "word_count", "topic"]


def load_csv(path: Path) -> list[dict]:
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def main() -> None:
    if not BOT_FILE.exists():
        raise FileNotFoundError(f"Missing: {BOT_FILE}")
    if not HUMAN_FILE.exists():
        raise FileNotFoundError(f"Missing: {HUMAN_FILE}")

    bots   = load_csv(BOT_FILE)
    humans = load_csv(HUMAN_FILE)

    print(f"Bot comments:   {len(bots)}")
    print(f"Human comments: {len(humans)}")

    # Balance: trim the larger class to match the smaller
    min_count = min(len(bots), len(humans))
    if len(bots) != len(humans):
        print(f"Trimming to {min_count} rows per class for balance")
        random.seed(42)
        bots   = random.sample(bots,   min_count)
        humans = random.sample(humans, min_count)

    rows = bots + humans
    random.seed(42)
    random.shuffle(rows)

    with open(OUTPUT_FILE, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)

    bot_count   = sum(1 for r in rows if int(r["label"]) == 1)
    human_count = sum(1 for r in rows if int(r["label"]) == 0)
    print(f"\n✓ {len(rows)} total rows → {OUTPUT_FILE}")
    print(f"  label=1 (bot):   {bot_count}")
    print(f"  label=0 (human): {human_count}")


if __name__ == "__main__":
    main()
