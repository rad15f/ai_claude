# YouTube Bot Detector — Chrome Extension

## What this is
Chrome extension (Manifest V3) that scores YouTube comments for bot probability.
Overlays a color-coded badge on each comment. Fully local, no backend required.

## Tech stack
- TypeScript, Vite, vite-plugin-web-extension
- Transformers.js (@xenova/transformers) for AI text detection
- YouTube Data API v3 for channel enrichment
- chrome.storage.local (7-day cache), chrome.storage.session (per-session state)
- Shadow DOM for UI injection

## Key architecture rules
1. content.ts runs in the page context — DOM access only, no heavy computation
2. background.ts is the Service Worker — runs Transformers.js, calls YouTube API
3. Message passing: content.ts → background.ts via chrome.runtime.sendMessage
4. Never block the main thread. All async work goes in background.ts
5. Show heuristic score instantly; update badge when AI classifier finishes

## Scoring formula
- Short comment (<50 words): account 40% + text 30% + crossComment 15% + AI 15%
- Long comment (≥50 words):  account 35% + text 25% + crossComment 15% + AI 25%
- Author override: if authorAIPercent ≥ 0.80 and totalScored ≥ 3 → floor score at 75%

## AI classifier
- Model: Hello-SimpleAI/chatgpt-detector-roberta via Transformers.js
- Trained on ChatGPT-3.5/4 vs human text; good at catching engagement farm outputs
- Loads on first use (~120MB quantized), cached via Cache API
- Runs in background Service Worker only
- Returns { label: 'ChatGPT'|'Human', score: 0-1 } — 'ChatGPT' = AI-generated

## YouTube API
- User supplies their own API key (stored in chrome.storage.local)
- Cache channel profiles for 7 days to preserve quota
- Only fetch each channelId once per session
- Quota cost: ~10 units per channel; free tier = ~1,000 channel lookups/day

## Do not
- Import Transformers.js in content.ts (too heavy for content script)
- Use localStorage (not available in extensions; use chrome.storage)
- Make synchronous API calls
- Hard-code any API keys

## Build
```bash
npm install
npm run dev       # watch mode
npm run build     # production bundle → dist/
npm run typecheck # type-only check
```

## Loading in Chrome
1. Run `npm run build`
2. Open chrome://extensions
3. Enable "Developer mode"
4. Click "Load unpacked" → select the `dist/` folder
