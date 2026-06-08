import type { Comment } from '../types.js'

export interface CrossCommentSignalResult {
  score: number
  signals: string[]
}

// Session cache of all comments seen on the current video page
const sessionComments: Map<string, Comment> = new Map()

export function registerComment(comment: Comment): void {
  sessionComments.set(comment.id, comment)
}

export function clearSessionCache(): void {
  sessionComments.clear()
}

// Placeholder — logic implemented in Phase 2
export function scoreCrossCommentSignals(_comment: Comment): CrossCommentSignalResult {
  return { score: 0, signals: [] }
}
