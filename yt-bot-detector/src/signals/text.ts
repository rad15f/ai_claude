export interface TextSignalResult {
  score: number
  signals: string[]
}

// ─── Signal data ──────────────────────────────────────────────────────────────

const PROMO_KEYWORDS = [
  'check my channel', 'sub for sub', 'subscribe to me', 'visit my channel',
  'check out my', 'follow me', 'follow back',
  'crypto', 'bitcoin', 'ethereum', 'nft', 'token', 'invest now',
  'onlyfans', 'only fans', 'cashapp', 'cash app', 'paypal me',
  'make money', 'earn money', 'passive income', 'work from home',
  'dm me', 'dm for', 'click link', 'link in bio', 'link in my bio',
  'free followers', 'get followers', 'buy followers',
  'i make $', 'i earn $', 'i made $',
  // Scam-specific evasion terms — deliberate misspellings/abbreviations
  // that real users almost never write but scammers use to bypass filters
  'tgram',     // Telegram abbreviation used by scam networks
  't.me/',     // raw Telegram link (our URL regex requires https://, this catches the rest)
  'ph#',       // phone number abbreviation used to evade detection
  'ph #',
]

const TEMPLATE_PATTERNS = [
  /i\s+(make|earn|made|earned)\s+\$[\d,.]+\s+(per|a|every)\s+(day|week|month)/i,
  /earn\s+\$[\d,.]+\s+(daily|weekly|monthly)/i,
  /making\s+\$[\d,.]+\s+(from home|online|every day)/i,
  /\$[\d,.]+\s+in\s+(just\s+)?\d+\s+(days?|weeks?|hours?)/i,
]

// Crypto ticker spam: $TOKEN$$ or $TOKEN$ (double/single dollar sign suffix used by bots
// to evade simple keyword filters while still signalling a pumped coin)
const TICKER_SPAM_RE = /\$[A-Z0-9]{2,12}\$\$?/g

// ─── Scorer ───────────────────────────────────────────────────────────────────

export function scoreTextSignals(text: string): TextSignalResult {
  const signals: string[] = []
  // Collect weights of every signal that fires, then combine via probabilistic OR:
  //   score = 1 - ∏(1 - wᵢ)
  // Each additional signal has diminishing impact; result naturally stays ≤ 1.0.
  const fired: number[] = []

  const lower = text.toLowerCase()
  const words = text.trim().split(/\s+/)
  const wordCount = words.length

  // 1. URL signals — mutually exclusive (else-if): external URL takes precedence
  if (/https?:\/\/(?!(?:www\.)?youtu(?:be\.com|\.be))[^\s]+/.test(text)) {
    fired.push(0.65)   // raised from 0.55 to compensate for prob-OR dampening
    signals.push('External URL')
  } else if (
    /\b\w+[·•․‧⋅◦⦁⦿・･•·◦∙⋅\[\(](?:dot|com|net|org|io|co)\b/i.test(text) ||
    /\b\w+\s*\(dot\)\s*\w{2,6}\b/i.test(text) ||
    /\b\w+\s+dot\s+(?:com|net|org|io|co)\b/i.test(text)
  ) {
    fired.push(0.55)   // raised from 0.45
    signals.push('Disguised URL')
  }

  // 2. Hashtag spam — 3 or more hashtags
  const hashtagCount = (text.match(/#\w+/g) ?? []).length
  if (hashtagCount >= 3) {
    fired.push(0.30)   // raised from 0.20
    signals.push(`Hashtag spam (${hashtagCount} tags)`)
  }

  // 3. Promotional keywords
  const foundPromo = PROMO_KEYWORDS.find(kw => lower.includes(kw))
  if (foundPromo) {
    fired.push(0.40)   // raised from 0.30
    signals.push(`Promo: "${foundPromo}"`)
  }

  // 4. Income template fill-in
  const foundTemplate = TEMPLATE_PATTERNS.find(p => p.test(text))
  if (foundTemplate) {
    fired.push(0.40)
    signals.push('Income template')
  }

  // 4b. Crypto ticker spam — $TOKEN$$ or $TOKEN$ suffix pattern used by pump bots
  const tickerMatches = text.match(TICKER_SPAM_RE) ?? []
  if (tickerMatches.length >= 1) {
    fired.push(0.55)
    signals.push(`Ticker spam: ${tickerMatches.slice(0, 2).join(', ')}`)
  }

  // 5. Emoji-only or very short comment — <4 words
  const emojiOnly = /^[\p{Emoji}\s]+$/u.test(text.trim())
  if (emojiOnly || wordCount < 4) {
    fired.push(0.12)   // raised from 0.10
    signals.push('Very short / emoji-only')
  }

  // 6. All-caps ratio > 60%
  const letters = text.replace(/[^a-zA-Z]/g, '')
  if (letters.length > 8) {
    const upperRatio = (text.match(/[A-Z]/g) ?? []).length / letters.length
    if (upperRatio > 0.6) {
      fired.push(0.12)   // raised from 0.10
      signals.push('Excessive caps')
    }
  }

  // 7. Repeated characters: "heeelllo", "!!!!!!"
  if (/(.)\1{4,}/.test(text)) {
    fired.push(0.10)   // raised from 0.08
    signals.push('Repeated characters')
  }

  // 8. Non-ASCII / zero-width spam characters
  if (/[​-‍﻿­]/.test(text)) {
    fired.push(0.12)   // raised from 0.10
    signals.push('Zero-width characters')
  } else {
    const nonAsciiRatio = (text.match(/[^\x00-\x7F]/g) ?? []).length / text.length
    if (nonAsciiRatio > 0.35 && wordCount > 4) {
      fired.push(0.10)   // raised from 0.08
      signals.push('High non-ASCII ratio')
    }
  }

  // Probabilistic OR
  const score = fired.length === 0
    ? 0
    : 1 - fired.reduce((acc, w) => acc * (1 - w), 1)

  return { score, signals }
}
