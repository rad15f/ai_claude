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

DATASET_DIR      = Path(__file__).parent.parent / "dataset"
HUMAN_FILE       = DATASET_DIR / "human_comments.csv"
OUTPUT_FILE      = DATASET_DIR / "training_data.csv"
FIELDNAMES       = ["text", "label", "archetype", "word_count", "topic"]

# All bot sources — script skips any that don't exist yet.
# Cap: None means use all rows; a number caps that source via random sample,
# so no single model dominates the bot class (Haiku was 94% of bot data before this).
BOT_SOURCES = [
    (DATASET_DIR / "bot_comments.csv",        "Claude Haiku",     1400),
    (DATASET_DIR / "bot_comments_llama.csv",  "Llama 3 (Groq)",   None),
    (DATASET_DIR / "bot_comments_gpt.csv",    "GPT-4o mini",      None),
    (DATASET_DIR / "bot_comments_gemini.csv", "Gemini Flash",     None),
    (DATASET_DIR / "real_bot_comments.csv",   "Real scraped",     None),
]


def load_csv(path: Path) -> list[dict]:
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def main() -> None:
    if not HUMAN_FILE.exists():
        raise FileNotFoundError(f"Missing: {HUMAN_FILE}")

    humans = load_csv(HUMAN_FILE)

    bots: list[dict] = []
    random.seed(42)
    for path, label, cap in BOT_SOURCES:
        if path.exists():
            rows = load_csv(path)
            if cap is not None and len(rows) > cap:
                rows = random.sample(rows, cap)
                print(f"  {label:<22} {len(rows):>5} comments  (capped from more, {path.name})")
            else:
                print(f"  {label:<22} {len(rows):>5} comments  ({path.name})")
            bots.extend(rows)
        else:
            print(f"  {label:<22}     — not found, skipping ({path.name})")

    print(f"Bot comments:   {len(bots)} total")
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
