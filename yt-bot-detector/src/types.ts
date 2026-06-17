export interface ChannelProfile {
  channelId: string
  accountCreatedAt: string
  subscriberCount: number
  videoCount: number
  viewCount: number
  country: string | null
  hasBannerImage: boolean
  hasDescription: boolean
  hiddenSubscriberCount: boolean
  hasPublicPlaylists: boolean
  fetchedAt: number
}

export interface Comment {
  id: string
  videoId: string
  text: string
  likes: number
  replyCount: number
  publishedAt: string
  isReply: boolean
  isVideoOwner: boolean
  author: {
    name: string
    channelId: string | null
    channelUrl: string | null
    avatarUrl: string | null
  }
  channel?: ChannelProfile
}

export interface AuthorAIProfile {
  channelId: string
  totalScored: number
  aiCount: number
  aiPercent: number
  lastUpdated: number
}

export type BotClassification = 'human' | 'suspicious' | 'likely-bot'

export interface ScoreBreakdown {
  account: number
  text: number
  crossComment: number
  ai: number
  final: number
  classification: BotClassification
  topSignals: string[]
}

export interface CommentScore {
  commentId: string
  score: ScoreBreakdown
  isPartial: boolean  // true when AI/account enrichment is still pending
}

// Messages passed between content.ts and background.ts via chrome.runtime.sendMessage
export type ExtensionMessage =
  | { type: 'SCORE_COMMENT'; comment: Comment }
  | { type: 'SCORE_COMMENT_RESULT'; commentId: string; score: ScoreBreakdown }
  | { type: 'ENRICH_CHANNEL'; channelId: string }
  | { type: 'ENRICH_CHANNEL_RESULT'; channelId: string; profile: ChannelProfile }
  | { type: 'GET_VIDEO_STATS'; videoId: string }
  | { type: 'VIDEO_STATS_RESULT'; stats: VideoStats }
  | { type: 'SET_API_KEY'; apiKey: string }
  | { type: 'MODEL_LOADING'; progress: number }
  | { type: 'MODEL_READY' }

export interface VideoStats {
  videoId: string
  totalScanned: number
  flaggedCount: number
  signalFrequency: Record<string, number>
}

export interface StoredSettings {
  apiKey?: string
  sensitivityThreshold: number  // 0–100, default 60
  hideAboveThreshold: boolean
  serverSyncEnabled: boolean
  serverUrl?: string
}

export interface CachedChannelEntry {
  profile: ChannelProfile
  expiresAt: number
}
