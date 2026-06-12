#!/usr/bin/env python3
"""
Generate 5,000 bot-like YouTube comments for training data.
Output: dataset/bot_comments.csv

Usage:
    cd yt-bot-detector
    pip install anthropic
    ANTHROPIC_API_KEY=sk-ant-... python training/generate_bot_comments.py
"""

import anthropic
import csv
import json
import os
import random
import sys
import time
from pathlib import Path

# ─── Config ──────────────────────────────────────────────────────────────────

MODEL = "claude-haiku-4-5"
TOTAL_BATCHES = 250
BATCH_SIZE = 20
SAVE_EVERY = 50
OUTPUT_DIR = Path(__file__).parent.parent / "dataset"
OUTPUT_FILE = OUTPUT_DIR / "bot_comments.csv"
FIELDNAMES = ["text", "label", "archetype", "word_count", "topic"]

TOPICS = [
    "Python programming tutorial",
    "personal finance and investing",
    "fitness and workout routine",
    "crypto and blockchain",
    "music production",
    "cooking recipe",
    "travel vlog",
    "self-help and productivity",
    "gaming walkthrough",
    "tech product review",
    "mental health and anxiety",
    "car review",
    "makeup tutorial",
    "real estate investing",
    "language learning",
    "AI and machine learning",
    "weightlifting",
    "day trading",
    "home renovation",
    "relationship advice",
]

PROMPT_TEMPLATE = """\
Generate 20 YouTube engagement bot comments for a video about: {topic}

Return ONLY a JSON array with no explanation or markdown. Each object must have:
- "text": the comment string
- "archetype": one of generic_praise | fake_relatability | hollow_question | vague_reaction | fake_milestone
- "word_count": integer word count of the text

Rules:
- Comments must be generic and non-specific — applicable to ANY video on this topic
- Do NOT reference specific facts, timestamps, creator names, or video details
- Mix all 5 archetypes across the 20 comments
- Length distribution: 6 comments under 5 words, 10 comments 5-20 words, 4 comments 20-40 words
- 2 of the 20 should include typos or informal slang
- Emoji distribution: 7 with no emoji, 8 with 1-2 emoji, 5 with 3+ emoji or emoji-only suffix

Example output format:
[{{"text": "This is so helpful!", "archetype": "generic_praise", "word_count": 4}}]"""


# ─── API call with retry ──────────────────────────────────────────────────────

def call_with_retry(
    client: anthropic.Anthropic,
    topic: str,
    max_retries: int = 3,
) -> list[dict]:
    for attempt in range(max_retries):
        try:
            response = client.messages.create(
                model=MODEL,
                max_tokens=2048,
                messages=[{"role": "user", "content": PROMPT_TEMPLATE.format(topic=topic)}],
            )

            raw = response.content[0].text.strip()

            # Strip markdown code fences if the model wraps output
            if raw.startswith("```"):
                parts = raw.split("```")
                raw = parts[1] if len(parts) > 1 else raw
                if raw.startswith("json"):
                    raw = raw[4:]
            raw = raw.strip()

            parsed = json.loads(raw)
            if not isinstance(parsed, list):
                raise ValueError(f"Expected JSON array, got {type(parsed).__name__}")
            return parsed

        except (json.JSONDecodeError, ValueError) as e:
            wait = 2 ** attempt + random.uniform(0, 1)
            print(f"  [attempt {attempt + 1}/{max_retries}] Parse error: {e} — retrying in {wait:.1f}s")
            if attempt < max_retries - 1:
                time.sleep(wait)

        except anthropic.RateLimitError:
            wait = 2 ** (attempt + 2) + random.uniform(0, 2)
            print(f"  [attempt {attempt + 1}/{max_retries}] Rate limit — waiting {wait:.1f}s")
            if attempt < max_retries - 1:
                time.sleep(wait)

        except anthropic.AuthenticationError:
            sys.exit("ERROR: Invalid API key. Set ANTHROPIC_API_KEY to your real key and retry.")

        except anthropic.APIError as e:
            wait = 2 ** attempt + random.uniform(0, 1)
            print(f"  [attempt {attempt + 1}/{max_retries}] API error: {e} — retrying in {wait:.1f}s")
            if attempt < max_retries - 1:
                time.sleep(wait)

    print(f"  Failed all {max_retries} attempts for topic: {topic}")
    return []


# ─── CSV helpers ─────────────────────────────────────────────────────────────

def write_csv(path: Path, rows: list[dict]) -> None:
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(rows)


def load_existing(path: Path) -> tuple[list[dict], set[str]]:
    if not path.exists():
        return [], set()
    rows = []
    texts = set()
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            rows.append(row)
            texts.add(row["text"])
    return rows, texts


# ─── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    all_rows, seen_texts = load_existing(OUTPUT_FILE)
    if all_rows:
        print(f"Resuming — {len(all_rows)} comments already saved.")

    client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY from env

    # Distribute topics evenly: topic_cycle[i] is the topic for batch i
    topic_cycle = [TOPICS[i % len(TOPICS)] for i in range(TOTAL_BATCHES)]

    # Resume from where we left off based on saved row count
    start_batch = len(all_rows) // BATCH_SIZE

    for batch_idx in range(start_batch, TOTAL_BATCHES):
        topic = topic_cycle[batch_idx]
        comments = call_with_retry(client, topic)

        added = 0
        for comment in comments:
            text = str(comment.get("text", "")).strip()
            if not text or text in seen_texts:
                continue
            row = {
                "text": text,
                "label": 1,
                "archetype": comment.get("archetype", "unknown"),
                "word_count": comment.get("word_count", len(text.split())),
                "topic": topic,
            }
            all_rows.append(row)
            seen_texts.add(text)
            added += 1

        print(
            f"Batch {batch_idx + 1:>3}/{TOTAL_BATCHES} | "
            f"total={len(all_rows):>5} | +{added:>2} | {topic}"
        )

        # Incremental save every SAVE_EVERY batches
        if (batch_idx + 1) % SAVE_EVERY == 0:
            write_csv(OUTPUT_FILE, all_rows)
            print(f"  ✓ Checkpoint saved ({len(all_rows)} rows)")

        # Small delay to avoid hammering the API
        time.sleep(0.25)

    # Final save — deduplicate on text just in case
    unique_rows = list({row["text"]: row for row in all_rows}.values())
    write_csv(OUTPUT_FILE, unique_rows)

    dupes = len(all_rows) - len(unique_rows)
    print(f"\nDone. {len(unique_rows)} unique comments → {OUTPUT_FILE}")
    if dupes:
        print(f"Removed {dupes} duplicate(s) in final dedup pass.")


if __name__ == "__main__":
    main()
