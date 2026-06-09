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
]

const TEMPLATE_PATTERNS = [
  /i\s+(make|earn|made|earned)\s+\$[\d,.]+\s+(per|a|every)\s+(day|week|month)/i,
  /earn\s+\$[\d,.]+\s+(daily|weekly|monthly)/i,
  /making\s+\$[\d,.]+\s+(from home|online|every day)/i,
  /\$[\d,.]+\s+in\s+(just\s+)?\d+\s+(days?|weeks?|hours?)/i,
]

// ─── Scorer ───────────────────────────────────────────────────────────────────

export function scoreTextSignals(text: string): TextSignalResult {
  const signals: string[] = []
  let score = 0

  const lower = text.toLowerCase()
  const words = text.trim().split(/\s+/)
  const wordCount = words.length

  // 1. External URL — not linking to YouTube (weight: 0.40)
  if (/https?:\/\/(?!(?:www\.)?youtu(?:be\.com|\.be))[^\s]+/.test(text)) {
    score += 0.40
    signals.push('External URL')
  }

  // 2. Promotional keywords (weight: 0.25)
  const foundPromo = PROMO_KEYWORDS.find(kw => lower.includes(kw))
  if (foundPromo) {
    score += 0.25
    signals.push(`Promo: "${foundPromo}"`)
  }

  // 3. Income template fill-in (weight: 0.30)
  const foundTemplate = TEMPLATE_PATTERNS.find(p => p.test(text))
  if (foundTemplate) {
    score += 0.30
    signals.push('Income template')
  }

  // 4. Emoji-only or very short comment — <4 words (weight: 0.10)
  const emojiOnly = /^[\p{Emoji}\s]+$/u.test(text.trim())
  if (emojiOnly || wordCount < 4) {
    score += 0.10
    signals.push('Very short / emoji-only')
  }

  // 5. All-caps ratio > 60% (weight: 0.10)
  const letters = text.replace(/[^a-zA-Z]/g, '')
  if (letters.length > 8) {
    const upperRatio = (text.match(/[A-Z]/g) ?? []).length / letters.length
    if (upperRatio > 0.6) {
      score += 0.10
      signals.push('Excessive caps')
    }
  }

  // 6. Repeated characters: "heeelllo", "!!!!!!" (weight: 0.08)
  if (/(.)\1{4,}/.test(text)) {
    score += 0.08
    signals.push('Repeated characters')
  }

  // 7. Non-ASCII / zero-width spam characters (weight: 0.10)
  // Zero-width or Unicode lookalikes are a strong spam signal
  if (/[​-‍﻿­]/.test(text)) {
    score += 0.10
    signals.push('Zero-width characters')
  } else {
    const nonAsciiRatio = (text.match(/[^\x00-\x7F]/g) ?? []).length / text.length
    if (nonAsciiRatio > 0.35 && wordCount > 4) {
      score += 0.08
      signals.push('High non-ASCII ratio')
    }
  }

  return { score: Math.min(1, score), signals }
}
