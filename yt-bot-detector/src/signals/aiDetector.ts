// Runs in background.ts (Service Worker) only — never import in content.ts.
// @xenova/transformers fetches the model (~45 MB) from HuggingFace on first use
// and caches it via the Cache API so subsequent SW restarts are fast.

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — package ships JS + JSDoc, no bundled .d.ts; skipLibCheck handles it
import { pipeline } from '@xenova/transformers'

export interface AIDetectorResult {
  score: number   // 0–1, probability of AI-generated text
  ready: boolean  // false while model is loading, failed, or text is too short
}

// Module-level singletons so the classifier survives across message calls
// within a single SW lifetime. Chrome may kill and restart the SW, in which
// case the model reloads from the Cache API (fast) rather than re-downloading.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _clf: any = null
let _loading = false
let _failed = false

async function getClassifier(): Promise<unknown> {
  if (_clf) return _clf
  if (_failed || _loading) return null

  _loading = true
  try {
    _clf = await pipeline('text-classification', 'tomaarsen/slop-detector-mini-2', {
      quantized: true,  // use int8-quantized ONNX — ~4x smaller, ~2x faster
    })
    console.log('[ytbd] AI classifier ready')
  } catch (e) {
    console.warn('[ytbd] AI classifier failed to load:', e)
    _failed = true
  } finally {
    _loading = false
  }
  return _clf
}

/**
 * Kick off model download in the background. Call once when the SW starts so
 * the classifier is warm before the first comment arrives.
 */
export function warmupClassifier(): void {
  void getClassifier()
}

export async function scoreAIText(text: string): Promise<AIDetectorResult> {
  const wordCount = text.trim().split(/\s+/).length
  // Under 8 words: too little signal for a text classifier to be reliable
  if (wordCount < 8) return { score: 0, ready: false }

  const clf = await getClassifier()
  if (!clf) return { score: 0, ready: false }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = await (clf as any)(text, { truncation: true, max_length: 512 })
    const item: { label: string; score: number } = Array.isArray(raw) ? raw[0] : raw
    if (!item) return { score: 0, ready: false }

    // Normalize label — model may return 'AI'/'HUMAN', 'LABEL_1'/'LABEL_0', etc.
    const label = item.label.toUpperCase()
    const isAI = label === 'AI' || label === 'LABEL_1' || label === 'POSITIVE'
    const score = isAI ? item.score : 1 - item.score
    return { score, ready: true }
  } catch (e) {
    console.warn('[ytbd] AI scoring error:', e)
    return { score: 0, ready: false }
  }
}

export function getAIWeight(text: string): number {
  const wordCount = text.trim().split(/\s+/).length
  return wordCount >= 50 ? 0.25 : 0.15
}
