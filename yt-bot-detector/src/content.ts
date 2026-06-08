// Content script — DOM scraping and badge injection
// No heavy computation here; send work to background.ts via sendMessage

import type { Comment, ExtensionMessage, ScoreBreakdown } from './types.js'

const BATCH_INTERVAL_MS = 300
const pendingComments: Map<string, Comment> = new Map()
let batchTimer: ReturnType<typeof setTimeout> | null = null
let currentVideoId = ''

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

function injectBadge(commentEl: Element, commentId: string): void {
  const existing = commentEl.querySelector('.ytbd-badge')
  if (existing) return

  const timestampEl = commentEl.querySelector('.published-time-text, yt-formatted-string.published-time-text')
  if (!timestampEl) return

  const badge = document.createElement('span')
  badge.className = 'ytbd-badge ytbd-badge--loading'
  badge.dataset['commentId'] = commentId
  badge.setAttribute('aria-label', 'Bot probability score loading')

  // Shadow DOM wrapper to isolate styles from YouTube's CSS
  const host = document.createElement('span')
  const shadow = host.attachShadow({ mode: 'closed' })

  const style = document.createElement('style')
  style.textContent = BADGE_STYLES
  shadow.appendChild(style)
  shadow.appendChild(badge)

  timestampEl.insertAdjacentElement('afterend', host)
}

function updateBadge(commentId: string, score: ScoreBreakdown): void {
  const badge = document.querySelector<HTMLElement>(`.ytbd-badge[data-comment-id="${commentId}"]`)
  if (!badge) return

  const pct = Math.round(score.final * 100)
  badge.textContent = `${pct}%`
  badge.className = `ytbd-badge ytbd-badge--${score.classification}`
  badge.setAttribute('aria-label', `Bot probability: ${pct}%`)
  badge.title = score.topSignals.join(' · ') || score.classification

  badge.classList.remove('ytbd-badge--loading')
}

const BADGE_STYLES = `
  .ytbd-badge {
    display: inline-block;
    font-size: 11px;
    font-weight: 600;
    padding: 1px 5px;
    border-radius: 4px;
    margin-left: 6px;
    vertical-align: middle;
    min-width: 28px;
    text-align: center;
    cursor: default;
    transition: background 0.3s, color 0.3s;
  }
  .ytbd-badge--loading {
    background: #e5e5e5;
    color: #888;
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

function scheduleBatch(): void {
  if (batchTimer !== null) return
  batchTimer = setTimeout(flushBatch, BATCH_INTERVAL_MS)
}

function flushBatch(): void {
  batchTimer = null
  if (pendingComments.size === 0) return

  for (const [, comment] of pendingComments) {
    const msg: ExtensionMessage = { type: 'SCORE_COMMENT', comment }
    chrome.runtime.sendMessage(msg, (response: ExtensionMessage | undefined) => {
      if (!response || response.type !== 'SCORE_COMMENT_RESULT') return
      updateBadge(response.commentId, response.score)
    })
  }

  pendingComments.clear()
}

// ─── MutationObserver ─────────────────────────────────────────────────────────

function processNode(node: Node): void {
  if (!(node instanceof Element)) return

  const selectors = ['ytd-comment-renderer', 'ytd-comment-reply-renderer']
  for (const sel of selectors) {
    if (node.matches(sel)) handleCommentElement(node)
    node.querySelectorAll(sel).forEach(handleCommentElement)
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

  // Scan any already-rendered comments
  Array.from(document.querySelectorAll('ytd-comment-renderer, ytd-comment-reply-renderer'))
    .forEach(handleCommentElement)
}

// ─── Navigation (YouTube is a SPA) ───────────────────────────────────────────

function onNavigate(): void {
  currentVideoId = getVideoId()
  pendingComments.clear()
}

// YouTube fires yt-navigate-finish for SPA navigations
window.addEventListener('yt-navigate-finish', onNavigate)

// ─── Boot ─────────────────────────────────────────────────────────────────────

currentVideoId = getVideoId()
startObserver()
