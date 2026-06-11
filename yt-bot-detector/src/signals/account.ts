import type { ChannelProfile } from '../types.js'

export interface AccountSignalResult {
  score: number
  signals: string[]
}

const MS_PER_DAY = 86_400_000

// Regex for auto-generated YouTube handles like @user-ab12cd34ef
const AUTO_HANDLE_RE = /^@?user-[a-z0-9]{8,}$/i

export function scoreAccountSignals(profile: ChannelProfile): AccountSignalResult {
  const signals: string[] = []
  // Collect weights of every signal that fires, then combine via probabilistic OR:
  //   score = 1 - ∏(1 - wᵢ)
  // This prevents double-penalisation and naturally stays ≤ 1.0 without clamping.
  const fired: number[] = []

  const ageMs = Date.now() - new Date(profile.accountCreatedAt).getTime()
  const ageDays = ageMs / MS_PER_DAY

  // 1. Account age — mutually exclusive tiers (else-if), so only one weight fires
  if (ageDays < 7) {
    fired.push(0.50)   // raised from 0.40
    signals.push(`Brand-new account (${Math.round(ageDays)}d old)`)
  } else if (ageDays < 30) {
    fired.push(0.38)   // raised from 0.28
    signals.push(`New account (${Math.round(ageDays)}d old)`)
  } else if (ageDays < 180) {
    fired.push(0.22)   // raised from 0.14
    signals.push(`Young account (${Math.round(ageDays / 30)}mo old)`)
  }

  // 2. Subscriber count — mutually exclusive tiers
  if (profile.subscriberCount === 0) {
    fired.push(0.20)   // raised from 0.14
    signals.push('0 subscribers')
  } else if (profile.subscriberCount < 10) {
    fired.push(0.10)   // raised from 0.07
    signals.push(`${profile.subscriberCount} subscribers`)
  }

  // 3. Video count
  if (profile.videoCount === 0) {
    fired.push(0.18)   // raised from 0.12
    signals.push('No videos uploaded')
  }

  // 4. No channel description
  if (!profile.hasDescription) {
    fired.push(0.10)   // raised from 0.07
    signals.push('No channel description')
  }

  // 5. No banner image
  if (!profile.hasBannerImage) {
    fired.push(0.07)   // raised from 0.05
    signals.push('No banner image')
  }

  // 6. Hidden subscriber count on small channel
  if (profile.hiddenSubscriberCount && profile.subscriberCount < 1000) {
    fired.push(0.07)   // raised from 0.05
    signals.push('Hidden subscriber count')
  }

  // 7. No country set
  if (!profile.country) {
    fired.push(0.04)   // raised from 0.03
    signals.push('No country set')
  }

  // 8. Abnormal view/sub ratio — very high views but almost no subs
  if (
    profile.subscriberCount > 0 &&
    profile.viewCount > 0 &&
    profile.viewCount / profile.subscriberCount > 500 &&
    profile.subscriberCount < 100
  ) {
    fired.push(0.08)   // raised from 0.06
    signals.push('Abnormal view/sub ratio')
  }

  // 9. Auto-generated handle
  if (AUTO_HANDLE_RE.test(profile.channelId)) {
    fired.push(0.14)   // raised from 0.10
    signals.push('Auto-generated handle')
  }

  // Probabilistic OR: each additional signal has diminishing impact
  const score = fired.length === 0
    ? 0
    : 1 - fired.reduce((acc, w) => acc * (1 - w), 1)

  return { score, signals }
}
