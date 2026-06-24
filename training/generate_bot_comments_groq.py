#!/usr/bin/env python3
"""
Generate ~1,500 bot-like YouTube comments using Llama 3 via Groq (free tier).
Output: dataset/bot_comments_llama.csv

Usage:
    pip install groq
    GROQ_API_KEY=gsk_... python3 training/generate_bot_comments_groq.py

Get a free key at: https://console.groq.com
"""

import csv
import json
import os
import random
import sys
import time
from pathlib import Path

try:
    from groq import Groq
except ImportError:
    sys.exit("Missing dependency: pip install groq")

# ─── Config ──────────────────────────────────────────────────────────────────

MODEL        = "llama-3.3-70b-versatile"   # best quality on free tier
TOTAL_BATCHES = 75                          # 75 × 20 = 1,500 comments
BATCH_SIZE   = 20
SAVE_EVERY   = 25
OUTPUT_DIR   = Path(__file__).parent.parent / "dataset"
OUTPUT_FILE  = OUTPUT_DIR / "bot_comments_llama.csv"
FIELDNAMES   = ["text", "label", "archetype", "word_count", "topic"]

TOPICS = [
    "crypto trading signals 2025",
    "how to make money online fast",
    "passive income ideas",
    "bitcoin price prediction",
    "altcoin season 2025",
    "how to lose weight fast",
    "best investment strategy",
    "day trading for beginners",
    "Python programming tutorial",
    "personal finance tips",
    "fitness and workout routine",
    "music production tutorial",
    "real estate investing",
    "self-help and productivity",
    "gaming walkthrough",
    "tech product review",
    "mental health and anxiety",
    "makeup tutorial",
    "relationship advice",
    "how to start a business",
]

PROMPT_TEMPLATE = """\
Generate 20 YouTube bot comments for a video about: {topic}

Return ONLY a JSON array with no explanation or markdown. Each object must have:
- "text": the comment string
- "archetype": one of generic_praise | fake_relatability | hollow_question | vague_reaction | fake_milestone | crypto_pump
- "word_count": integer word count of the text

Rules:
- Comments must look like they were mass-posted by bot accounts
- Do NOT reference specific facts, timestamps, creator names, or video details
- Mix all 6 archetypes across the 20 comments
- Length distribution: 6 comments under 5 words, 10 comments 5-25 words, 4 comments 25-60 words
- crypto_pump archetype: fake story about profit gains, pump tokens, financial freedom — include fake $ amounts
- fake_relatability archetype: personal hardship story that conveniently ends with financial success via a guru/tool
- 2 of the 20 should include typos or informal slang
- Emoji distribution: 7 with no emoji, 8 with 1-2 emoji, 5 with 3+ emoji

Example output format:
[{{"text": "This changed my life!", "archetype": "generic_praise", "word_count": 4}}]"""


def call_with_retry(client: Groq, topic: str, max_retries: int = 3) -> list:
    for attempt in range(max_retries):
        try:
            response = client.chat.completions.create(
                model=MODEL,
                max_tokens=2048,
                messages=[{"role": "user", "content": PROMPT_TEMPLATE.format(topic=topic)}],
            )

            raw = response.choices[0].message.content.strip()

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

        except Exception as e:
            err = str(e).lower()
            if "rate" in err or "429" in err:
                wait = 30 + random.uniform(0, 5)
                print(f"  Rate limit — waiting {wait:.0f}s")
                if attempt < max_retries - 1:
                    time.sleep(wait)
            elif "auth" in err or "401" in err:
                sys.exit("ERROR: Invalid GROQ_API_KEY. Get one at https://console.groq.com")
            else:
                wait = 2 ** attempt + random.uniform(0, 1)
                print(f"  [attempt {attempt + 1}/{max_retries}] Error: {e} — retrying in {wait:.1f}s")
                if attempt < max_retries - 1:
                    time.sleep(wait)

    print(f"  Failed all {max_retries} attempts for topic: {topic}")
    return []


def main() -> None:
    api_key = os.environ.get("GROQ_API_KEY", "")
    if not api_key:
        sys.exit("Set GROQ_API_KEY environment variable. Get a free key at https://console.groq.com")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Resume support
    all_rows: list = []
    seen_texts: set = set()
    if OUTPUT_FILE.exists():
        with open(OUTPUT_FILE, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                all_rows.append(row)
                seen_texts.add(row["text"])
        print(f"Resuming — {len(all_rows)} comments already saved.")

    client = Groq(api_key=api_key)
    topic_cycle = [TOPICS[i % len(TOPICS)] for i in range(TOTAL_BATCHES)]
    start_batch = len(all_rows) // BATCH_SIZE

    for batch_idx in range(start_batch, TOTAL_BATCHES):
        topic = topic_cycle[batch_idx]
        comments = call_with_retry(client, topic)

        added = 0
        for comment in comments:
            text = str(comment.get("text", "")).strip()
            if not text or text in seen_texts:
                continue
            all_rows.append({
                "text":       text,
                "label":      1,
                "archetype":  comment.get("archetype", "unknown"),
                "word_count": comment.get("word_count", len(text.split())),
                "topic":      topic,
            })
            seen_texts.add(text)
            added += 1

        print(
            f"Batch {batch_idx + 1:>3}/{TOTAL_BATCHES} | "
            f"total={len(all_rows):>5} | +{added:>2} | {topic}"
        )

        if (batch_idx + 1) % SAVE_EVERY == 0:
            with open(OUTPUT_FILE, "w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
                writer.writeheader()
                writer.writerows(all_rows)
            print(f"  ✓ Checkpoint saved ({len(all_rows)} rows)")

        time.sleep(1.0)  # Groq free tier: be gentle

    unique_rows = list({r["text"]: r for r in all_rows}.values())
    with open(OUTPUT_FILE, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(unique_rows)

    print(f"\n✓ {len(unique_rows)} unique Llama bot comments → {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
