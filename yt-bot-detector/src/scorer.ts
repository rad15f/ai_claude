import type { Comment, AuthorAIProfile, BotClassification, ScoreBreakdown } from './types.js'
import { scoreAccountSignals } from './signals/account.js'
import { scoreTextSignals } from './signals/text.js'
import { scoreCrossCommentSignals } from './signals/crossComment.js'

function classify(score: number): BotClassification {
  if (score < 0.30) return 'human'
  if (score < 0.60) return 'suspicious'
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

  const aiWeight = isLong ? 0.25 : 0.15
  const accountWeight = isLong ? 0.35 : 0.40
  const textWeight = isLong ? 0.25 : 0.30
  const crossWeight = 0.15

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
