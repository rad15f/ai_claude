// Service Worker — handles YouTube API calls, Transformers.js, and scoring

import type {
  ExtensionMessage,
  CachedChannelEntry,
  ChannelProfile,
  AuthorAIProfile,
  StoredSettings,
} from './types.js'
import { scoreComment } from './scorer.js'
import { registerComment, initCrossCommentStore } from './signals/crossComment.js'
import { scoreAIText, warmupClassifier } from './signals/aiDetector.js'

// Start loading the AI model immediately so it's warm when comments arrive.
// Model is ~45 MB on first download, then served from Cache API.
warmupClassifier()

// Load persisted cross-video comment store so duplicates are detected across
// sessions, not just within the current service worker lifetime.
initCrossCommentStore().catch(console.error)

const CHANNEL_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000  // 7 days
const YT_API_BASE = 'https://www.googleapis.com/youtube/v3'

// In-flight deduplication: if multiple comments from the same author arrive
// before the first API response is cached, reuse the same promise.
const pendingChannelFetches = new Map<string, Promise<ChannelProfile | null>>()

// ─── Channel enrichment ───────────────────────────────────────────────────────

async function getSettings(): Promise<StoredSettings> {
  const result = await chrome.storage.local.get('settings')
  return (result['settings'] as StoredSettings | undefined) ?? {
    sensitivityThreshold: 40,
    hideAboveThreshold: false,
    serverSyncEnabled: false,
  }
}

async function getCachedChannel(channelId: string): Promise<ChannelProfile | null> {
  const key = `channel:${channelId}`
  const result = await chrome.storage.local.get(key)
  const entry = result[key] as CachedChannelEntry | undefined
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    await chrome.storage.local.remove(key)
    return null
  }
  return entry.profile
}

async function cacheChannel(profile: ChannelProfile): Promise<void> {
  const key = `channel:${profile.channelId}`
  const entry: CachedChannelEntry = {
    profile,
    expiresAt: Date.now() + CHANNEL_CACHE_TTL_MS,
  }
  await chrome.storage.local.set({ [key]: entry })
}

async function fetchChannelProfile(channelId: string, apiKey: string): Promise<ChannelProfile | null> {
  // Channel IDs start with "UC"; everything else is a handle (e.g. "OliSW" from /@OliSW)
  const idParam = channelId.startsWith('UC')
    ? `id=${encodeURIComponent(channelId)}`
    : `forHandle=${encodeURIComponent(channelId)}`

  const url =
    `${YT_API_BASE}/channels?part=snippet,statistics,brandingSettings,status` +
    `&${idParam}&key=${encodeURIComponent(apiKey)}`

  console.log(`[ytbd] Fetching channel: ${idParam}`)

  const res = await fetch(url)
  if (!res.ok) {
    console.warn(`[ytbd] API error ${res.status} for ${channelId}`)
    return null
  }

  const data = await res.json() as { items?: YoutubeChannelItem[] }
  console.log(`[ytbd] API response for ${channelId}:`, {
    itemCount: data.items?.length ?? 0,
    publishedAt: data.items?.[0]?.snippet.publishedAt,
    subscribers: data.items?.[0]?.statistics.subscriberCount,
    videos: data.items?.[0]?.statistics.videoCount,
  })

  const item = data.items?.[0]
  if (!item) {
    console.warn(`[ytbd] No channel found for: ${channelId}`)
    return null
  }

  // Check for public playlists — real users typically organize content into playlists
  const channelIdForPlaylist = item.id ?? channelId
  let hasPublicPlaylists = false
  try {
    const plUrl = `${YT_API_BASE}/playlists?part=id&channelId=${encodeURIComponent(channelIdForPlaylist)}&maxResults=1&key=${encodeURIComponent(apiKey)}`
    const plRes = await fetch(plUrl)
    if (plRes.ok) {
      const plData = await plRes.json() as { pageInfo?: { totalResults?: number } }
      hasPublicPlaylists = (plData.pageInfo?.totalResults ?? 0) > 0
    }
  } catch { /* non-fatal */ }

  const profile: ChannelProfile = {
    channelId,
    accountCreatedAt: item.snippet.publishedAt,
    subscriberCount: parseInt(item.statistics.subscriberCount ?? '0', 10),
    videoCount: parseInt(item.statistics.videoCount ?? '0', 10),
    viewCount: parseInt(item.statistics.viewCount ?? '0', 10),
    country: item.snippet.country ?? null,
    hasBannerImage: Boolean(item.brandingSettings?.image?.bannerExternalUrl),
    hasDescription: Boolean(item.snippet.description?.trim()),
    hiddenSubscriberCount: item.statistics.hiddenSubscriberCount === true,
    hasPublicPlaylists,
    fetchedAt: Date.now(),
  }

  console.log(`[ytbd] Profile built for ${channelId}:`, profile)
  return profile
}

// ─── Author AI profile (session-scoped) ──────────────────────────────────────

async function getAuthorAIProfile(channelId: string): Promise<AuthorAIProfile | null> {
  const key = `ai_profile:${channelId}`
  const result = await chrome.storage.session.get(key)
  return (result[key] as AuthorAIProfile | undefined) ?? null
}

async function updateAuthorAIProfile(channelId: string, isAI: boolean): Promise<void> {
  const key = `ai_profile:${channelId}`
  const existing = await getAuthorAIProfile(channelId)
  const profile: AuthorAIProfile = existing ?? {
    channelId,
    totalScored: 0,
    aiCount: 0,
    aiPercent: 0,
    lastUpdated: 0,
  }

  profile.totalScored += 1
  if (isAI) profile.aiCount += 1
  profile.aiPercent = profile.aiCount / profile.totalScored
  profile.lastUpdated = Date.now()

  await chrome.storage.session.set({ [key]: profile })
}

// ─── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    handleMessage(message).then(sendResponse).catch(console.error)
    return true  // keep message channel open for async response
  }
)

async function handleMessage(message: ExtensionMessage): Promise<unknown> {
  switch (message.type) {
    case 'SCORE_COMMENT': {
      const { comment } = message
      registerComment(comment)

      const settings = await getSettings()

      // Enrich channel if we have a channelId and an API key
      if (comment.author.channelId && settings.apiKey) {
        const cached = await getCachedChannel(comment.author.channelId)
        if (cached) {
          comment.channel = cached
        } else {
          const id = comment.author.channelId
          // Reuse in-flight request if one is already pending for this channel
          let pending = pendingChannelFetches.get(id)
          if (!pending) {
            pending = fetchChannelProfile(id, settings.apiKey).then(async profile => {
              pendingChannelFetches.delete(id)
              if (profile) await cacheChannel(profile)
              return profile
            })
            pendingChannelFetches.set(id, pending)
          }
          const fresh = await pending
          if (fresh) comment.channel = fresh
        }
      }

      const aiResult = await scoreAIText(comment.text)
      const channelId = comment.author.channelId ?? comment.author.name
      if (aiResult.ready) {
        await updateAuthorAIProfile(channelId, aiResult.score > 0.6)
      }

      const authorProfile = comment.author.channelId
        ? await getAuthorAIProfile(comment.author.channelId)
        : null

      const scoreResult = scoreComment({
        comment,
        aiScore: aiResult.score,
        aiReady: aiResult.ready,
        ...(authorProfile ? { authorProfile } : {}),
      })

      return {
        type: 'SCORE_COMMENT_RESULT',
        commentId: comment.id,
        score: scoreResult,
      }
    }

    case 'SET_API_KEY': {
      const settings = await getSettings()
      await chrome.storage.local.set({
        settings: { ...settings, apiKey: message.apiKey },
      })
      return { ok: true }
    }

    default:
      return null
  }
}

// ─── YouTube API types (internal, not exported) ───────────────────────────────

interface YoutubeChannelItem {
  id: string
  snippet: {
    publishedAt: string
    description?: string
    country?: string
  }
  statistics: {
    subscriberCount?: string
    videoCount?: string
    viewCount?: string
    hiddenSubscriberCount?: boolean
  }
  brandingSettings?: {
    image?: { bannerExternalUrl?: string }
  }
}
