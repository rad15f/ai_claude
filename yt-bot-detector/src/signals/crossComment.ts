import type { Comment } from '../types.js'

export interface CrossCommentSignalResult {
  score: number
  signals: string[]
}

// Session cache: commentId → Comment
const sessionComments: Map<string, Comment> = new Map()

export function registerComment(comment: Comment): void {
  sessionComments.set(comment.id, comment)
}

export function clearSessionCache(): void {
  sessionComments.clear()
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

// Simple Levenshtein distance (capped for performance)
function levenshtein(a: string, b: string, cap = 200): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1
  const m = Math.min(a.length, cap)
  const n = Math.min(b.length, cap)
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j!] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1]![j - 1]!
          : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!)
    }
  }
  return dp[m]![n]!
}

// ─── Scorer ───────────────────────────────────────────────────────────────────

export function scoreCrossCommentSignals(comment: Comment): CrossCommentSignalResult {
  const signals: string[] = []
  let score = 0

  const normText = normalize(comment.text)
  if (normText.length < 10) return { score: 0, signals: [] }

  let exactDupes = 0
  let nearDupes = 0

  for (const [id, other] of sessionComments) {
    // Skip self and same author
    if (id === comment.id) continue
    if (other.author.channelId && other.author.channelId === comment.author.channelId) continue

    const otherNorm = normalize(other.text)
    if (otherNorm.length < 10) continue

    if (normText === otherNorm) {
      exactDupes++
    } else {
      // Only run Levenshtein on similarly-lengthed texts to save CPU
      const lenDiff = Math.abs(normText.length - otherNorm.length)
      if (lenDiff < 20) {
        const dist = levenshtein(normText, otherNorm)
        if (dist < 10) nearDupes++
      }
    }
  }

  // Exact duplicate from a different author — very high signal (flat +0.50)
  if (exactDupes > 0) {
    score = Math.max(score, 0.50)
    signals.push(`Exact duplicate (${exactDupes} other${exactDupes > 1 ? 's' : ''})`)
  }

  // Near-duplicate — high signal (flat +0.30)
  if (nearDupes > 0) {
    score = Math.max(score, 0.30)
    signals.push(`Near-duplicate (${nearDupes} similar)`)
  }

  // Username cluster: multiple @FirstnameSurname#### accounts
  const nameNumberPattern = /^@?[A-Z][a-z]+[A-Z][a-z]+\d{3,}$/
  if (nameNumberPattern.test(comment.author.name)) {
    let clusterCount = 0
    for (const other of sessionComments.values()) {
      if (other.author.name !== comment.author.name && nameNumberPattern.test(other.author.name)) {
        clusterCount++
      }
    }
    if (clusterCount >= 2) {
      score = Math.max(score, 0.25)
      signals.push('Username cluster pattern')
    }
  }

  return { score: Math.min(1, score), signals }
}
