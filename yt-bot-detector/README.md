# YouTube Bot Detector

A Chrome extension that overlays a bot-probability score on every YouTube comment. Detection runs entirely in your browser — no data leaves your machine.

![Badge preview: green = Human, yellow = Suspicious, red = Likely Bot]

---

## Features

- **Instant heuristic scoring** — text signals fire in < 10ms per comment
- **AI text detection** — powered by Transformers.js running locally in the extension's Service Worker (~45MB one-time download)
- **Account enrichment** — pulls channel age, subscriber count, and profile completeness via YouTube Data API v3
- **Cross-comment analysis** — detects duplicate text, username clusters, and coordinated bot farms within a video session
- **Color-coded badges** — green / yellow / red pill injected next to each comment timestamp
- **Popup dashboard** — per-video stats, top signals, sensitivity slider, hide-bots toggle
- **Privacy first** — all processing is local; no backend required

---

## How It Works

Each comment is scored on four axes that combine into a final 0–100% bot probability:

| Signal category | What it checks | Weight (short / long comment) |
|---|---|---|
| **Account** | Account age, subscriber count, no avatar/banner/description, auto-generated handle | 40% / 35% |
| **Text** | Spam URLs, promo keywords, all-caps, gibberish, template phrases | 30% / 25% |
| **Cross-comment** | Exact/near duplicates, coordinated timing, shared avatar hashes | 15% / 15% |
| **AI classifier** | Transformers.js `slop-detector-mini-2` model, runs in background | 15% / 25% |

**Classification tiers:**

| Score | Badge | Label |
|---|---|---|
| < 30% | 🟢 Green | Human |
| 30–60% | 🟡 Yellow | Suspicious |
| > 60% | 🔴 Red | Likely Bot |

---

## Installation (Developer Mode)

### Prerequisites
- Node.js 18+
- A YouTube Data API v3 key ([get one here](#getting-a-youtube-api-key))

### Steps

```bash
# 1. Clone the repo
git clone https://github.com/your-username/yt-bot-detector.git
cd yt-bot-detector

# 2. Install dependencies
npm install

# 3. Build the extension
npm run build
```

Then load it into Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `dist/` folder

The extension icon will appear in your toolbar. Open it and paste your API key.

---

## Getting a YouTube API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (or select an existing one)
3. Navigate to **APIs & Services → Library** → search **YouTube Data API v3** → **Enable**
4. Go to **APIs & Services → Credentials** → **+ Create Credentials → API key**
5. *(Recommended)* Restrict the key:
   - **API restrictions:** YouTube Data API v3 only
   - **Application restrictions:** Websites → `https://www.youtube.com/*`
6. Copy the key and paste it into the extension popup

> **Free tier:** 10,000 units/day. Each channel lookup costs ~10 units (~1,000 lookups/day). Channel profiles are cached for 7 days so repeat visits don't cost quota.

---

## Usage

1. Navigate to any YouTube video
2. Scroll down to the comments section
3. Each comment will show a colored pill badge next to its timestamp:
   - Hover the badge to see the **top 3 signals** that contributed to the score
   - The badge updates automatically when async enrichment (API + AI) finishes
4. Open the extension popup for:
   - Per-video stats (total scanned, flagged count)
   - Most common signals detected
   - Sensitivity threshold slider (40%–80%)
   - Option to hide flagged comments entirely

---

## Project Structure

```
yt-bot-detector/
├── manifest.json              # Chrome MV3 manifest
├── popup.html                 # Dashboard UI
├── src/
│   ├── types.ts               # Shared TypeScript interfaces
│   ├── background.ts          # Service Worker: API calls, AI scoring, cache
│   ├── content.ts             # DOM scraping, MutationObserver, badge injection
│   ├── popup.ts               # Popup dashboard logic
│   ├── scorer.ts              # Weighted score combiner
│   └── signals/
│       ├── account.ts         # YouTube API account signals
│       ├── text.ts            # Heuristic text signals
│       ├── crossComment.ts    # Duplicate/cluster detection
│       └── aiDetector.ts      # Transformers.js wrapper
├── vite.config.ts
├── tsconfig.json
└── package.json
```

---

## Development

```bash
npm run dev         # Watch mode — rebuilds on file change
npm run build       # Production build → dist/
npm run typecheck   # Type-only check, no emit
```

After any code change in watch mode, go to `chrome://extensions` and click the **refresh icon** on the extension card to reload it.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Extension API | Chrome Manifest V3 |
| Language | TypeScript (strict) |
| Build | Vite + vite-plugin-web-extension |
| DOM scraping | Content script + MutationObserver |
| AI classifier | Transformers.js + `slop-detector-mini-2` |
| Account data | YouTube Data API v3 |
| State / cache | `chrome.storage.local` + `chrome.storage.session` |
| UI isolation | Shadow DOM + CSS custom properties |

---

## Roadmap

- [x] **Phase 1** — Extension scaffold, comment scraper, data model
- [x] **Phase 2** — Account signals + text heuristics live
- [x] **Phase 3** — Transformers.js AI classifier integrated (ensemble: RoBERTa + DistilBERT)
- [x] **Phase 4** — Training data pipeline + fine-tuned YouTube bot comment classifier
- [ ] **Phase 5** — Popup dashboard + hide/filter controls
- [ ] **Phase 6** — Optional shared backend (Express + PostgreSQL)
- [ ] **Phase 7** — Accuracy evaluation, weight calibration
- [ ] **Phase 8** — Chrome Web Store publication

### Model improvement backlog

- [ ] **Diverse bot data** — generate bot comments using multiple models (GPT-4o, Gemini, Mistral, Llama) to reduce over-fit to Claude-Haiku output style
- [ ] **Real bot scraping** — collect labeled bot comments from known spam accounts on YouTube instead of relying solely on synthetic data
- [ ] **Human comment scraping** — scrape real YouTube comments via YouTube Data API v3 across diverse video categories for richer, more representative human examples (currently using a single static HuggingFace dataset)
- [ ] **Periodic retraining** — bot patterns evolve; retrain on fresh data every few months

---

## Privacy

- **No data leaves your browser** (local-only mode, default)
- The extension reads: comment text, author channel ID, video ID
- The extension sends to Google: channel IDs (via YouTube Data API, using *your* key)
- Nothing is sent to any third-party server
- A future optional backend (Phase 5) will be strictly opt-in

---

## Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/my-signal`
3. Make your changes and run `npm run typecheck`
4. Open a pull request with a description of the signal you added and why

---

## License

MIT
