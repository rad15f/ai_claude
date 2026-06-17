#!/usr/bin/env python3
"""
Side-by-side raw attribute comparison across THREE groups, with significance
testing (v3):
  - scam bots:        accounts behind textually-distinctive bot patterns
  - engagement bots:  accounts behind generic-praise patterns confirmed bot via
                       cross-video duplication, but filtered out of training data
  - normal:           random sample of commenters never seen in any bot pattern

v3 changes per data scientist feedback on v2:
  - Sample bumped 60 -> 300 per group (pools are 1,473 / 9,438 / 133,347 — cheap
    to sample more since channels.list costs ~1 unit per 50 IDs)
  - Mann-Whitney U for numeric attributes, Fisher's exact for proportions —
    distinguishes real gaps from noise at small sample sizes
  - video_count rechecked as a binary ("ever uploaded anything") in addition to
    the raw count, since median-0-everywhere doesn't rule out a binary signal
  - Banner-image gap checked within age-matched strata, to see whether the
    engagement-bot banner reversal is a behavioral signal or just an age proxy
    (older accounts = more likely to be from a YouTube era where banners were
    more commonly set up, regardless of bot/human)

Standing caveat (unchanged from v1/v2): "normal" means "no positive bot
evidence found by cross-video duplication," not "confirmed human." A bot that
varies its wording across videos is invisible to this detection method and
could be sitting in the normal sample. This caps confidence in the exact
magnitude of any gap reported here, even a statistically significant one.

Usage:
    cd yt-bot-detector
    YOUTUBE_API_KEY=<key> python3 training/compare_bot_vs_normal_accounts.py
"""

import csv
import json
import os
import random
import re
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

try:
    import requests
except ImportError:
    sys.exit("Missing dependency: pip install requests")

try:
    from scipy.stats import mannwhitneyu, fisher_exact
except ImportError:
    sys.exit("Missing dependency: pip install scipy")

# ─── Config ──────────────────────────────────────────────────────────────────

API_KEY       = os.environ.get("YOUTUBE_API_KEY", "")
YT_BASE       = "https://www.googleapis.com/youtube/v3"
DATASET_DIR   = Path(__file__).parent.parent / "dataset"
PATTERNS_FILE = DATASET_DIR / "all_confirmed_bot_patterns.json"
REAL_BOT_CSV  = DATASET_DIR / "real_bot_comments.csv"
CACHE_JSONL   = DATASET_DIR / "scrape_comments_cache.jsonl"
OUTPUT_FILE   = DATASET_DIR / "bot_vs_normal_comparison.json"

SAMPLE_SIZE = 300
AGE_BINS = [(0, 365), (365, 365 * 3), (365 * 3, 365 * 5), (365 * 5, 999999)]
AGE_BIN_LABELS = ["<1yr", "1-3yr", "3-5yr", "5yr+"]


def normalize(text: str) -> str:
    t = text.lower().strip()
    t = re.sub(r'\s+', ' ', t)
    t = re.sub(r'[.!?,;]+$', '', t)
    return t


def parse_iso(ts: str) -> datetime:
    ts = re.sub(r'\.(\d+)', lambda m: '.' + m.group(1)[:6].ljust(6, '0'), ts)
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def fetch_channel_data(channel_ids: list[str]) -> dict[str, dict]:
    """Batch-fetch channel snippet/statistics for up to 50 IDs per call (1 unit/call)."""
    result: dict[str, dict] = {}
    for i in range(0, len(channel_ids), 50):
        batch = channel_ids[i:i + 50]
        res = requests.get(f"{YT_BASE}/channels", params={
            "part": "snippet,statistics,brandingSettings",
            "id": ",".join(batch),
            "key": API_KEY,
        }, timeout=15)
        if not res.ok:
            print(f"  HTTP {res.status_code} fetching channel batch")
            continue
        data = res.json()
        for item in data.get("items", []):
            cid = item["id"]
            snippet = item.get("snippet", {})
            stats = item.get("statistics", {})
            branding = item.get("brandingSettings", {})
            created = snippet.get("publishedAt")
            age_days = None
            if created:
                age_days = (datetime.now(timezone.utc) - parse_iso(created)).days
            sub_count = int(stats.get("subscriberCount", 0) or 0)
            vid_count = int(stats.get("videoCount", 0) or 0)
            result[cid] = {
                "account_age_days":  age_days,
                "subscriber_count":  sub_count,
                "video_count":       vid_count,
                "has_uploaded":      vid_count > 0,
                "has_description":   bool(snippet.get("description", "").strip()),
                "has_banner":        bool(branding.get("image", {}).get("bannerExternalUrl")),
                "hidden_sub_count":  stats.get("hiddenSubscriberCount", False),
                "has_country":       bool(snippet.get("country")),
            }
        time.sleep(0.2)
    return result


def summarize_numeric(values: list) -> dict:
    values = [v for v in values if v is not None]
    if not values:
        return {"median": None, "mean": None, "n": 0}
    return {"median": round(statistics.median(values), 1), "mean": round(statistics.mean(values), 1), "n": len(values)}


def summarize_boolean(values: list) -> dict:
    values = [v for v in values if v is not None]
    if not values:
        return {"pct_true": None, "n": 0, "n_true": 0}
    n_true = sum(bool(v) for v in values)
    return {"pct_true": round(100 * n_true / len(values), 1), "n": len(values), "n_true": n_true}


def group_summary(channel_data: dict) -> dict:
    return {
        "account_age_days": summarize_numeric([d["account_age_days"] for d in channel_data.values()]),
        "subscriber_count": summarize_numeric([d["subscriber_count"] for d in channel_data.values()]),
        "video_count":      summarize_numeric([d["video_count"] for d in channel_data.values()]),
        "has_uploaded":     summarize_boolean([d["has_uploaded"] for d in channel_data.values()]),
        "has_description":  summarize_boolean([d["has_description"] for d in channel_data.values()]),
        "has_banner":       summarize_boolean([d["has_banner"] for d in channel_data.values()]),
        "hidden_sub_count": summarize_boolean([d["hidden_sub_count"] for d in channel_data.values()]),
        "has_country":      summarize_boolean([d["has_country"] for d in channel_data.values()]),
    }


def sample(pool: set, n: int) -> set:
    random.seed(42)
    return set(random.sample(sorted(pool), min(n, len(pool))))


def mwu_test(a: list, b: list) -> tuple:
    a = [v for v in a if v is not None]
    b = [v for v in b if v is not None]
    if len(a) < 2 or len(b) < 2:
        return None, None
    try:
        stat, p = mannwhitneyu(a, b, alternative="two-sided")
        return stat, p
    except ValueError:
        return None, None


def fisher_test(a_true: int, a_n: int, b_true: int, b_n: int) -> float:
    table = [[a_true, a_n - a_true], [b_true, b_n - b_true]]
    try:
        _, p = fisher_exact(table)
        return p
    except ValueError:
        return None


def sig_marker(p: float) -> str:
    if p is None:
        return "n/a"
    if p < 0.001:
        return f"p={p:.4f} ***"
    if p < 0.01:
        return f"p={p:.4f} **"
    if p < 0.05:
        return f"p={p:.4f} *"
    return f"p={p:.4f} (ns)"


def age_bucket(age_days: int) -> str:
    for (lo, hi), label in zip(AGE_BINS, AGE_BIN_LABELS):
        if lo <= age_days < hi:
            return label
    return AGE_BIN_LABELS[-1]


def main() -> None:
    if not API_KEY:
        sys.exit("Set YOUTUBE_API_KEY environment variable.")
    for f in (PATTERNS_FILE, REAL_BOT_CSV, CACHE_JSONL):
        if not f.exists():
            sys.exit(f"Missing {f}. Run scrape_real_bots.py first.")

    patterns = json.loads(PATTERNS_FILE.read_text())
    scam_keys = set()
    with open(REAL_BOT_CSV, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            scam_keys.add(normalize(row["text"]))

    scam_authors: set = set()
    engagement_authors: set = set()
    for key, data in patterns.items():
        authors = set(a for a in data["authors"] if a)
        if key in scam_keys:
            scam_authors |= authors
        else:
            engagement_authors |= authors

    overlap = scam_authors & engagement_authors
    scam_authors -= overlap
    engagement_authors -= overlap

    print(f"Pools — scam: {len(scam_authors)}, engagement: {len(engagement_authors)}, "
          f"excluded overlap: {len(overlap)}")

    scam_sample = sample(scam_authors, SAMPLE_SIZE)
    engagement_sample = sample(engagement_authors, SAMPLE_SIZE)

    all_authors: set = set()
    with open(CACHE_JSONL, encoding="utf-8") as f:
        for line in f:
            a = json.loads(line).get("author", "")
            if a:
                all_authors.add(a)
    normal_pool = all_authors - scam_authors - engagement_authors - overlap
    normal_sample = sample(normal_pool, SAMPLE_SIZE)

    print(f"Sampled: {len(scam_sample)} scam, {len(engagement_sample)} engagement, "
          f"{len(normal_sample)} normal\n")

    print("Fetching channel data (this will take a minute at this sample size)...")
    scam_data = fetch_channel_data(sorted(scam_sample))
    print(f"  scam: {len(scam_data)}/{len(scam_sample)}")
    engagement_data = fetch_channel_data(sorted(engagement_sample))
    print(f"  engagement: {len(engagement_data)}/{len(engagement_sample)}")
    normal_data = fetch_channel_data(sorted(normal_sample))
    print(f"  normal: {len(normal_data)}/{len(normal_sample)}\n")

    groups = {"scam_bots": scam_data, "engagement_bots": engagement_data, "normal": normal_data}
    summaries = {name: group_summary(data) for name, data in groups.items()}

    # ── Significance tests ──────────────────────────────────────────────────
    pairs = [("scam_bots", "engagement_bots"), ("scam_bots", "normal"), ("engagement_bots", "normal")]

    print("═" * 78)
    print("NUMERIC ATTRIBUTES — median (n) per group, Mann-Whitney U p-values pairwise")
    print("═" * 78)
    for attr in ["account_age_days", "subscriber_count", "video_count"]:
        print(f"\n{attr}:")
        for name in groups:
            s = summaries[name][attr]
            print(f"  {name:<18} median={s['median']!s:<10} mean={s['mean']!s:<10} n={s['n']}")
        for a, b in pairs:
            va = [d[attr] for d in groups[a].values()]
            vb = [d[attr] for d in groups[b].values()]
            _, p = mwu_test(va, vb)
            print(f"    {a} vs {b}: {sig_marker(p)}")

    print("\n" + "═" * 78)
    print("BOOLEAN ATTRIBUTES — % true per group, Fisher's exact p-values pairwise")
    print("═" * 78)
    for attr in ["has_uploaded", "has_description", "has_banner", "hidden_sub_count", "has_country"]:
        print(f"\n{attr}:")
        for name in groups:
            s = summaries[name][attr]
            print(f"  {name:<18} {s['pct_true']!s:>6}% true  ({s['n_true']}/{s['n']})")
        for a, b in pairs:
            sa, sb = summaries[a][attr], summaries[b][attr]
            p = fisher_test(sa["n_true"], sa["n"], sb["n_true"], sb["n"])
            print(f"    {a} vs {b}: {sig_marker(p)}")

    # ── Banner vs age confound check ────────────────────────────────────────
    print("\n" + "═" * 78)
    print("BANNER RATE WITHIN AGE-MATCHED STRATA (confound check)")
    print("═" * 78)
    for label in AGE_BIN_LABELS:
        print(f"\n  Age bucket: {label}")
        for name, data in groups.items():
            bucketed = [d for d in data.values() if d["account_age_days"] is not None
                        and age_bucket(d["account_age_days"]) == label]
            if not bucketed:
                print(f"    {name:<18} n=0")
                continue
            n_banner = sum(1 for d in bucketed if d["has_banner"])
            pct = round(100 * n_banner / len(bucketed), 1)
            print(f"    {name:<18} {pct:>6}% true  (n={len(bucketed)})")

    OUTPUT_FILE.write_text(json.dumps(summaries, indent=2, ensure_ascii=False))
    print(f"\n✓ Full comparison → {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
