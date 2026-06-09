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
  let score = 0

  const ageMs = Date.now() - new Date(profile.accountCreatedAt).getTime()
  const ageDays = ageMs / MS_PER_DAY

  // 1. Account age (weight: 0.20)
  if (ageDays < 30) {
    score += 0.20
    signals.push(`New account (${Math.round(ageDays)}d old)`)
  } else if (ageDays < 180) {
    score += 0.10
    signals.push(`Young account (${Math.round(ageDays / 30)}mo old)`)
  }

  // 2. Subscriber count (weight: 0.10)
  if (profile.subscriberCount === 0) {
    score += 0.10
    signals.push('0 subscribers')
  } else if (profile.subscriberCount < 10) {
    score += 0.05
    signals.push(`${profile.subscriberCount} subscribers`)
  }

  // 3. Video count (weight: 0.08)
  if (profile.videoCount === 0) {
    score += 0.08
    signals.push('No videos uploaded')
  }

  // 4. No channel description (weight: 0.05)
  if (!profile.hasDescription) {
    score += 0.05
    signals.push('No channel description')
  }

  // 5. No banner image (weight: 0.03)
  if (!profile.hasBannerImage) {
    score += 0.03
    signals.push('No banner image')
  }

  // 6. Hidden subscriber count on small channel (weight: 0.04)
  if (profile.hiddenSubscriberCount && profile.subscriberCount < 1000) {
    score += 0.04
    signals.push('Hidden subscriber count')
  }

  // 7. No country set (weight: 0.02)
  if (!profile.country) {
    score += 0.02
    signals.push('No country set')
  }

  // 8. Abnormal view/sub ratio — very high views but almost no subs (weight: 0.05)
  if (
    profile.subscriberCount > 0 &&
    profile.viewCount > 0 &&
    profile.viewCount / profile.subscriberCount > 500 &&
    profile.subscriberCount < 100
  ) {
    score += 0.05
    signals.push('Abnormal view/sub ratio')
  }

  // 9. Auto-generated handle (weight: 0.08)
  // We don't have the handle directly in the profile, but check channel ID patterns
  if (AUTO_HANDLE_RE.test(profile.channelId)) {
    score += 0.08
    signals.push('Auto-generated handle')
  }

  return { score: Math.min(1, score), signals }
}
