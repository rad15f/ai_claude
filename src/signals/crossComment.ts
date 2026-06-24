import type { Comment } from '../types.js'

export interface CrossCommentSignalResult {
  score: number
  signals: string[]
}

// ─── In-session state ─────────────────────────────────────────────────────────

// commentId → Comment seen in this session
const sessionComments: Map<string, Comment> = new Map()

// authorKey → all their comments this session (self-repetition detection)
const authorHistory: Map<string, Comment[]> = new Map()

export function clearSessionCache(): void {
  sessionComments.clear()
  authorHistory.clear()
}

// ─── Persistent cross-video store ─────────────────────────────────────────────
//
// Tracks normalized comment text → which video IDs it has appeared on across
// ALL sessions. Loaded from chrome.storage.local on startup so cross-video
// duplicates are caught even when the user visits videos in different sessions.
//
// Structure in storage: { xc_store: { [normalizedText]: videoId[] } }

const XC_STORE_KEY = 'xc_store'
const XC_MAX_ENTRIES = 8_000   // ~1-2 MB in storage; prune single-video entries first
const XC_FLUSH_DELAY_MS = 2_000

let xcStore: Map<string, string[]> = new Map()
let xcDirty = false
let xcFlushTimer: ReturnType<typeof setTimeout> | null = null

export async function initCrossCommentStore(): Promise<void> {
  const result = await chrome.storage.local.get(XC_STORE_KEY)
  const raw = (result[XC_STORE_KEY] ?? {}) as Record<string, string[]>
  xcStore = new Map(Object.entries(raw))
  console.log(`[ytbd] crossComment: loaded ${xcStore.size} cross-video entries from storage`)
}

function scheduleFlush(): void {
  if (xcFlushTimer !== null) return
  xcFlushTimer = setTimeout(async () => {
    xcFlushTimer = null
    if (!xcDirty) return
    xcDirty = false

    // Prune single-video entries first when over limit
    if (xcStore.size > XC_MAX_ENTRIES) {
      for (const [key, vids] of xcStore) {
        if (vids.length === 1) {
          xcStore.delete(key)
          if (xcStore.size <= XC_MAX_ENTRIES) break
        }
      }
    }

    await chrome.storage.local.set({ [XC_STORE_KEY]: Object.fromEntries(xcStore) })
  }, XC_FLUSH_DELAY_MS)
}

function recordTextOnVideo(normalizedText: string, videoId: string): void {
  if (normalizedText.length < 10 || !videoId) return
  const existing = xcStore.get(normalizedText) ?? []
  if (!existing.includes(videoId)) {
    xcStore.set(normalizedText, [...existing, videoId])
    xcDirty = true
    scheduleFlush()
  }
}

function getOtherVideosForText(normalizedText: string, currentVideoId: string): string[] {
  return (xcStore.get(normalizedText) ?? []).filter(v => v !== currentVideoId)
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

// ─── Public API ───────────────────────────────────────────────────────────────

export function registerComment(comment: Comment): void {
  sessionComments.set(comment.id, comment)

  const authorKey = comment.author.channelId ?? comment.author.name
  const history = authorHistory.get(authorKey) ?? []
  history.push(comment)
  authorHistory.set(authorKey, history)

  // Persist this comment's text against its video so future sessions can detect
  // cross-video duplicates even after the service worker restarts.
  recordTextOnVideo(normalize(comment.text), comment.videoId)
}

export function scoreCrossCommentSignals(comment: Comment): CrossCommentSignalResult {
  const signals: string[] = []
  let score = 0

  const normText = normalize(comment.text)
  if (normText.length < 10) return { score: 0, signals: [] }

  // ── 1. Persistent cross-video duplicate (survives across sessions) ────────
  const otherVideos = getOtherVideosForText(normText, comment.videoId)
  if (otherVideos.length >= 2) {
    score = Math.max(score, 0.75)
    signals.push(`Cross-video duplicate (${otherVideos.length + 1} videos across sessions)`)
  } else if (otherVideos.length === 1) {
    score = Math.max(score, 0.45)
    signals.push('Cross-video duplicate (2 videos across sessions)')
  }

  // ── 2. In-session exact/near duplicate from a different author ───────────
  let exactDupes = 0
  let nearDupes = 0

  for (const [id, other] of sessionComments) {
    if (id === comment.id) continue
    if (other.author.channelId && other.author.channelId === comment.author.channelId) continue

    const otherNorm = normalize(other.text)
    if (otherNorm.length < 10) continue

    if (normText === otherNorm) {
      exactDupes++
    } else {
      const lenDiff = Math.abs(normText.length - otherNorm.length)
      if (lenDiff < 20) {
        const dist = levenshtein(normText, otherNorm)
        if (dist < 10) nearDupes++
      }
    }
  }

  if (exactDupes > 0) {
    score = Math.max(score, 0.50)
    signals.push(`Exact duplicate in session (${exactDupes} other${exactDupes > 1 ? 's' : ''})`)
  }

  if (nearDupes > 0) {
    score = Math.max(score, 0.30)
    signals.push(`Near-duplicate in session (${nearDupes} similar)`)
  }

  // ── 3. Username cluster: multiple @FirstnameSurname#### accounts ─────────
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

  // ── 4. Same-author self-similarity ───────────────────────────────────────
  const authorKey = comment.author.channelId ?? comment.author.name
  const prevByAuthor = (authorHistory.get(authorKey) ?? []).filter(c => c.id !== comment.id)

  if (prevByAuthor.length > 0) {
    let selfSimilarCount = 0
    for (const prev of prevByAuthor) {
      const prevNorm = normalize(prev.text)
      if (prevNorm.length < 10) continue
      if (normText === prevNorm) {
        selfSimilarCount++
      } else {
        const lenDiff = Math.abs(normText.length - prevNorm.length)
        if (lenDiff < 25) {
          const dist = levenshtein(normText, prevNorm)
          if (dist < 15) selfSimilarCount++
        }
      }
    }
    if (selfSimilarCount > 0) {
      score = Math.max(score, 0.45)
      signals.push(`Self-repeating author (${selfSimilarCount} similar own comment${selfSimilarCount > 1 ? 's' : ''})`)
    }
  }

  return { score: Math.min(1, score), signals }
}
