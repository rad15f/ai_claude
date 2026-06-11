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
  aiScore: number         // 0–1; pass 0 when model is not ready
  aiReady: boolean        // true only when the AI classifier returned a real score
  authorProfile?: AuthorAIProfile
}

export function scoreComment({ comment, aiScore, aiReady, authorProfile }: ScorerInput): ScoreBreakdown {
  const accountResult = comment.channel
    ? scoreAccountSignals(comment.channel)
    : { score: 0, signals: [] as string[] }

  const textResult = scoreTextSignals(comment.text)
  const crossResult = scoreCrossCommentSignals(comment)

  const wordCount = comment.text.trim().split(/\s+/).length
  const isLong = wordCount >= 50

  // ─── Weight sets ────────────────────────────────────────────────────────────
  //
  // Phase 3 (AI classifier active):
  //   Short (<50 words): account 40% + text 30% + cross 15% + AI 15% = 100%
  //   Long  (≥50 words): account 35% + text 25% + cross 15% + AI 25% = 100%
  //
  // Phase 2 fallback (model loading / unavailable — AI weight redistributed):
  //   Short (<50 words): account 35% + text 50% + cross 15% + AI  0% = 100%
  //   Long  (≥50 words): account 35% + text 45% + cross 20% + AI  0% = 100%
  //
  // Rationale: when AI is absent, text carries the primary linguistic signal.
  // Cross-comment weight rises on long comments because verbatim repetition of
  // long text is a very strong bot indicator even without AI classification.
  // ─────────────────────────────────────────────────────────────────────────────

  let aiWeight: number
  let accountWeight: number
  let textWeight: number
  let crossWeight: number

  if (aiReady) {
    aiWeight      = isLong ? 0.25 : 0.15
    accountWeight = isLong ? 0.35 : 0.40
    textWeight    = isLong ? 0.25 : 0.30
    crossWeight   = 0.15
  } else {
    aiWeight      = 0
    accountWeight = 0.35
    textWeight    = isLong ? 0.45 : 0.50
    crossWeight   = isLong ? 0.20 : 0.15
  }

  let final =
    accountResult.score * accountWeight +
    textResult.score * textWeight +
    crossResult.score * crossWeight +
    aiScore * aiWeight

  // Author-level floor: if this author consistently posts AI content, raise floor to 75%
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
