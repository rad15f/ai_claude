// Runs in background.ts (Service Worker) only — never import in content.ts

export interface AIDetectorResult {
  score: number   // 0–1, probability of AI-generated text
  ready: boolean  // false while model is still loading
}

// Placeholder — Transformers.js integration implemented in Phase 3
export async function scoreAIText(_text: string): Promise<AIDetectorResult> {
  return { score: 0, ready: false }
}

export function getAIWeight(text: string): number {
  const wordCount = text.trim().split(/\s+/).length
  return wordCount >= 50 ? 0.25 : 0.15
}
