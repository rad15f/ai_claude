// Content script — DOM scraping and badge injection
// No heavy computation here; send work to background.ts via sendMessage

import type { Comment, ExtensionMessage, ScoreBreakdown, VideoStats } from './types.js'

const BATCH_INTERVAL_MS = 300
const pendingComments: Map<string, Comment> = new Map()
let batchTimer: ReturnType<typeof setTimeout> | null = null
let currentVideoId = ''

// ─── Stats tracking ───────────────────────────────────────────────────────────

const stats: VideoStats = {
  videoId: '',
  totalScanned: 0,
  flaggedCount: 0,
  signalFrequency: {},
}

function resetStats(videoId: string): void {
  stats.videoId = videoId
  stats.totalScanned = 0
  stats.flaggedCount = 0
  stats.signalFrequency = {}
}

function recordScore(score: ScoreBreakdown, threshold: number): void {
  stats.totalScanned++
  if (score.final >= threshold) stats.flaggedCount++
  for (const signal of score.topSignals) {
    stats.signalFrequency[signal] = (stats.signalFrequency[signal] ?? 0) + 1
  }
}

// ─── Video ID ─────────────────────────────────────────────────────────────────

function getVideoId(): string {
  const params = new URLSearchParams(window.location.search)
  return params.get('v') ?? ''
}

// ─── Comment extraction (updated for new YouTube DOM) ─────────────────────────

function extractCommentId(el: Element): string | null {
  // Extract unique comment ID from permalink: ?v=XXX&lc=COMMENT_ID
  const permalink = el.querySelector('a[href*="lc="]') as HTMLAnchorElement | null
  if (!permalink) return null
  const lc = new URLSearchParams(new URL(permalink.href).search).get('lc')
  return lc ?? null
}

function extractComment(el: Element): Comment | null {
  const id = extractCommentId(el)
  if (!id) return null

  // Comment text lives in yt-attributed-string > span
  const text = el.querySelector('yt-attributed-string span')?.textContent?.trim() ?? ''
  if (!text) return null

  // Author
  const authorAnchor = el.querySelector('h3 a') as HTMLAnchorElement | null
  const authorName = authorAnchor?.textContent?.trim() ?? ''
  const channelUrl = authorAnchor?.href ?? null
  const channelId = channelUrl ? extractChannelId(channelUrl) : null

  // Avatar
  const avatarEl = el.querySelector('img') as HTMLImageElement | null
  const avatarUrl = avatarEl?.src ?? null

  // Timestamp (the link to the comment itself)
  const publishedAt = (el.querySelector('ytd-comment-view-model a[href*="watch"]') as HTMLAnchorElement | null)
    ?.textContent?.trim() ?? ''

  // Likes — parse number from engagement bar text
  const likesRaw = el.querySelector('[aria-label*="like"], [aria-label*="Like"]')?.textContent?.trim() ?? '0'
  const likes = parseInt(likesRaw.replace(/[^\d]/g, '') || '0', 10)

  // Replies count — approximate from the replies button text
  const repliesRaw = el.querySelector('ytd-comment-replies-renderer')?.textContent?.trim() ?? ''
  const replyMatch = repliesRaw.match(/(\d+)\s+repl/i)
  const replyCount = replyMatch ? parseInt(replyMatch[1] ?? '0', 10) : 0

  // Is this a reply? Replies live inside ytd-comment-replies-renderer
  const isReply = el.closest('ytd-comment-replies-renderer') !== null

  // Is video owner? Check for creator badge / heart
  const isVideoOwner =
    el.querySelector('ytd-creator-heart-renderer') !== null ||
    el.hasAttribute('author-is-posting-owner')

  return {
    id,
    videoId: currentVideoId,
    text,
    likes,
    replyCount,
    publishedAt,
    isReply,
    isVideoOwner,
    author: { name: authorName, channelId, channelUrl, avatarUrl },
  }
}

function extractChannelId(url: string): string | null {
  // Handles /@handle, /channel/ID, /c/name, /user/name
  const match =
    url.match(/\/@([^/?]+)/) ??
    url.match(/\/(channel|c|user)\/([^/?]+)/)
  return match?.[1] ?? match?.[2] ?? null
}

// ─── Badge injection ──────────────────────────────────────────────────────────

const badgeHosts: Map<string, ShadowRoot> = new Map()

function injectBadge(commentEl: Element, commentId: string): void {
  if (badgeHosts.has(commentId)) return

  // Inject after the timestamp anchor
  const timestampEl =
    commentEl.querySelector('ytd-comment-view-model a[href*="watch"]') ??
    commentEl.querySelector('yt-formatted-string')
  if (!timestampEl) return

  const badge = document.createElement('span')
  badge.className = 'ytbd-badge ytbd-badge--loading'
  badge.textContent = '…'
  badge.setAttribute('aria-label', 'Bot probability score loading')

  const host = document.createElement('span')
  const shadow = host.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = BADGE_STYLES
  shadow.appendChild(style)
  shadow.appendChild(badge)

  timestampEl.insertAdjacentElement('afterend', host)
  badgeHosts.set(commentId, shadow)
}

function updateBadge(commentId: string, score: ScoreBreakdown): void {
  const shadow = badgeHosts.get(commentId)
  if (!shadow) return

  const badge = shadow.querySelector<HTMLElement>('.ytbd-badge')
  if (!badge) return

  const pct = Math.round(score.final * 100)
  badge.textContent = `${pct}%`
  badge.className = `ytbd-badge ytbd-badge--${score.classification}`
  badge.setAttribute('aria-label', `Bot probability: ${pct}%`)
  badge.title = score.topSignals.length
    ? score.topSignals.join(' · ')
    : score.classification
}

const BADGE_STYLES = `
  .ytbd-badge {
    display: inline-block;
    font-size: 11px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 4px;
    margin-left: 6px;
    vertical-align: middle;
    min-width: 32px;
    text-align: center;
    cursor: default;
    transition: background 0.3s, color 0.3s;
  }
  .ytbd-badge--loading {
    background: #e5e5e5;
    color: #aaa;
    font-size: 10px;
  }
  .ytbd-badge--human {
    background: #d4edda;
    color: #155724;
  }
  .ytbd-badge--suspicious {
    background: #fff3cd;
    color: #856404;
  }
  .ytbd-badge--likely-bot {
    background: #f8d7da;
    color: #721c24;
  }
`

// ─── Batch processing ─────────────────────────────────────────────────────────

async function getThreshold(): Promise<number> {
  const result = await chrome.storage.local.get('settings')
  const s = result['settings'] as { sensitivityThreshold?: number } | undefined
  return (s?.sensitivityThreshold ?? 60) / 100
}

function scheduleBatch(): void {
  if (batchTimer !== null) return
  batchTimer = setTimeout(() => { void flushBatch() }, BATCH_INTERVAL_MS)
}

async function flushBatch(): Promise<void> {
  batchTimer = null
  if (pendingComments.size === 0) return

  const threshold = await getThreshold()

  for (const [, comment] of pendingComments) {
    const msg: ExtensionMessage = { type: 'SCORE_COMMENT', comment }
    chrome.runtime.sendMessage(msg, (response: ExtensionMessage | undefined) => {
      void chrome.runtime.lastError
      if (!response || response.type !== 'SCORE_COMMENT_RESULT') return
      updateBadge(response.commentId, response.score)
      recordScore(response.score, threshold)
    })
  }

  pendingComments.clear()
}

// ─── Message listener (from popup) ───────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    if (message.type === 'GET_VIDEO_STATS') {
      sendResponse({ type: 'VIDEO_STATS_RESULT', stats } satisfies ExtensionMessage)
    }
    return false
  }
)

// ─── MutationObserver ─────────────────────────────────────────────────────────

// YouTube's new comment DOM uses ytd-comment-thread-renderer
const COMMENT_SELECTOR = 'ytd-comment-thread-renderer'

function processNode(node: Node): void {
  if (!(node instanceof Element)) return
  if (node.matches(COMMENT_SELECTOR)) handleCommentElement(node)
  Array.from(node.querySelectorAll(COMMENT_SELECTOR)).forEach(handleCommentElement)
}

function handleCommentElement(el: Element): void {
  const comment = extractComment(el)
  if (!comment) return

  injectBadge(el, comment.id)
  pendingComments.set(comment.id, comment)
  scheduleBatch()
}

function startObserver(): void {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        processNode(node)
      }
    }
  })

  observer.observe(document.body, { childList: true, subtree: true })

  // Scan already-rendered comments
  Array.from(document.querySelectorAll(COMMENT_SELECTOR))
    .forEach(handleCommentElement)
}

// ─── Navigation (YouTube is a SPA) ───────────────────────────────────────────

function onNavigate(): void {
  currentVideoId = getVideoId()
  pendingComments.clear()
  badgeHosts.clear()
  resetStats(currentVideoId)
}

window.addEventListener('yt-navigate-finish', onNavigate)

// ─── Boot ─────────────────────────────────────────────────────────────────────

currentVideoId = getVideoId()
resetStats(currentVideoId)
startObserver()
