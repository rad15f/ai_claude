import type { Comment, AuthorAIProfile, BotClassification, ScoreBreakdown } from './types.js'
import { scoreAccountSignals } from './signals/account.js'
import { scoreTextSignals } from './signals/text.js'
import { scoreCrossCommentSignals } from './signals/crossComment.js'

function classify(score: number): BotClassification {
  if (score < 0.30) return 'human'
  if (score < 0.55) return 'suspicious'
  return 'likely-bot'
}

export interface ScorerInput {
  comment: Comment
  aiScore: number         // 0–1, pass 0 if model not ready yet
  authorProfile?: AuthorAIProfile
}

export function scoreComment({ comment, aiScore, authorProfile }: ScorerInput): ScoreBreakdown {
  const accountResult = comment.channel
    ? scoreAccountSignals(comment.channel)
    : { score: 0, signals: [] as string[] }

  const textResult = scoreTextSignals(comment.text)
  const crossResult = scoreCrossCommentSignals(comment)

  const wordCount = comment.text.trim().split(/\s+/).length
  const isLong = wordCount >= 50

  // ─── Weight sets ────────────────────────────────────────────────────────────
  //
  // Phase 2 (current — AI classifier not yet active, aiScore always 0):
  //   Short (<50 words): account 30% + text 55% + cross 10% + AI  5% = 100%
  //   Long  (≥50 words): account 25% + text 45% + cross 10% + AI 20% = 100%
  //
  // Phase 3 (once Transformers.js model ships — update weights below):
  //   Short (<50 words): account 40% + text 35% + cross 10% + AI 15% = 100%
  //   Long  (≥50 words): account 35% + text 25% + cross 15% + AI 25% = 100%
  //
  // Rationale for Phase 3 shift: text weight drops because AI absorbs part of its
  // role. Account weight rises because AI frees text from carrying the full burden
  // of non-account signals.
  // ─────────────────────────────────────────────────────────────────────────────
  const aiWeight      = isLong ? 0.20 : 0.05
  const accountWeight = isLong ? 0.25 : 0.30
  const textWeight    = isLong ? 0.45 : 0.55
  const crossWeight   = 0.10

  let final =
    accountResult.score * accountWeight +
    textResult.score * textWeight +
    crossResult.score * crossWeight +
    aiScore * aiWeight

  // Author-level floor: if author consistently posts AI content, raise floor to 75%
  if (authorProfile && authorProfile.totalScored >= 3 && authorProfile.aiPercent >= 0.80) {
    final = Math.max(final, 0.75)
  }

  final = Math.min(1, Math.max(0, final))

  const allSignals = [
    ...accountResult.signals,
    ...textResult.signals,
    ...crossResult.signals,
  ]

  return {
    account: accountResult.score,
    text: textResult.score,
    crossComment: crossResult.score,
    ai: aiScore,
    final,
    classification: classify(final),
    topSignals: allSignals.slice(0, 3),
  }
}
