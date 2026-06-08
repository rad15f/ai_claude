import type { ChannelProfile } from '../types.js'

export interface AccountSignalResult {
  score: number        // 0–1
  signals: string[]    // human-readable labels for tooltip
}

// Placeholder — logic implemented in Phase 2
export function scoreAccountSignals(_profile: ChannelProfile): AccountSignalResult {
  return { score: 0, signals: [] }
}
