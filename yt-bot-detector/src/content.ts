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

// ─── Comment extraction ───────────────────────────────────────────────────────

function extractComment(el: Element): Comment | null {
  const id = el.getAttribute('id') ?? el.getAttribute('data-comment-id') ?? ''
  if (!id) return null

  const text =
    el.querySelector('#content-text')?.textContent?.trim() ?? ''

  const authorEl = el.querySelector('#author-text')
  const authorName = authorEl?.textContent?.trim() ?? ''
  const channelUrl = (authorEl as HTMLAnchorElement | null)?.href ?? null
  const channelId = channelUrl ? extractChannelId(channelUrl) : null

  const avatarEl = el.querySelector('#author-thumbnail img') as HTMLImageElement | null
  const avatarUrl = avatarEl?.src ?? null

  const likesEl = el.querySelector('#vote-count-middle')
  const likes = parseInt(likesEl?.textContent?.trim() ?? '0', 10) || 0

  const repliesEl = el.querySelector('#replies #header')
  const replyCount = parseInt(
    repliesEl?.textContent?.replace(/\D/g, '') ?? '0',
    10
  ) || 0

  const timestampEl = el.querySelector('.published-time-text a, yt-formatted-string.published-time-text')
  const publishedAt = timestampEl?.textContent?.trim() ?? ''

  const isReply = el.tagName.toLowerCase() === 'ytd-comment-reply-renderer'
  const isVideoOwner = el.hasAttribute('is-highlighted') || el.hasAttribute('author-is-posting-owner')

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
  const match = url.match(/\/(channel|c|user)\/([^/?]+)/) ?? url.match(/@([^/?]+)/)
  return match?.[2] ?? match?.[1] ?? null
}

// ─── Badge injection ──────────────────────────────────────────────────────────

// Map commentId → shadow host so we can reach the badge later
const badgeHosts: Map<string, ShadowRoot> = new Map()

function injectBadge(commentEl: Element, commentId: string): void {
  if (badgeHosts.has(commentId)) return

  const timestampEl = commentEl.querySelector('.published-time-text, yt-formatted-string.published-time-text')
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
      void chrome.runtime.lastError  // suppress disconnected errors
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

function processNode(node: Node): void {
  if (!(node instanceof Element)) return

  const selectors = ['ytd-comment-renderer', 'ytd-comment-reply-renderer']
  for (const sel of selectors) {
    if (node.matches(sel)) handleCommentElement(node)
    Array.from(node.querySelectorAll(sel)).forEach(handleCommentElement)
  }
}

function handleCommentElement(el: Element): void {
  const comment = extractComment(el)
  if (!comment || !comment.text) return

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
  Array.from(document.querySelectorAll('ytd-comment-renderer, ytd-comment-reply-renderer'))
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
