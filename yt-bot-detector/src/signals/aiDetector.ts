// Runs in background.ts (Service Worker) only — never import in content.ts.
// Both models download from HuggingFace on first use and cache via Cache API.

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — package ships JS + JSDoc, no bundled .d.ts; skipLibCheck handles it
import { pipeline, env } from '@xenova/transformers'

// Disable local-model lookup — the extension has no /models/ directory.
;(env as Record<string, unknown>)['allowLocalModels'] = false
// Bypass Cache API — forces a fresh fetch from HuggingFace.
// Remove this once both models are confirmed stable.
;(env as Record<string, unknown>)['useBrowserCache'] = false

// Service Workers cannot spawn Worker threads — force single-threaded WASM.
// Without this, onnxruntime picks ort-wasm-simd-threaded.wasm which calls
// URL.createObjectURL() internally, an API unavailable in SW context.
;(env as any).backends.onnx.wasm.numThreads = 1  // eslint-disable-line @typescript-eslint/no-explicit-any

export interface AIDetectorResult {
  score: number   // 0–1, probability of AI-generated text
  ready: boolean  // false while all models are still loading or unavailable
}

// Both models are from Hello-SimpleAI, trained on the same ChatGPT-3.5/4 vs
// human dataset but with different architectures — RoBERTa-base and DistilBERT.
// Architectural diversity means they have different decision boundaries and
// different failure modes, which is the main benefit of ensembling.
//
// Neither ships a quantized ONNX — both require quantized: false.
// Labels for both: 'ChatGPT' (AI) | 'Human'

// SLOT 0 — ChatGPT-3.5/4 vs human detector, ONNX-converted and hosted on HuggingFace.
//           Labels: 'CHATGPT' (AI) | 'HUMAN'. quantized: true → loads model_quantized.onnx (125 MB).
//
// SLOT 1 — YouTube-specific bot comment detector, fine-tuned DistilBERT.
//           Trained on 4380 Claude-generated bot comments vs 4380 real YouTube comments.
//           Labels: 'bot' | 'human'. quantized: true → loads model_quantized.onnx (64 MB).
const MODELS = [
  { name: 'rad15f/chatgpt-detector-roberta-onnx', isAI: (l: string) => l === 'CHATGPT', quantized: true },
  { name: 'rad15f/yt-bot-comment-detector',        isAI: (l: string) => l === 'BOT',     quantized: true },
] as const

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Clf = any

interface ClfSlot {
  clf: Clf | null
  loading: boolean
  failed: boolean
}

const slots: ClfSlot[] = MODELS.map(() => ({ clf: null, loading: false, failed: false }))

async function loadSlot(index: number): Promise<Clf | null> {
  const slot = slots[index]!
  if (slot.clf) return slot.clf
  if (slot.failed || slot.loading) return null

  const name = MODELS[index]!.name
  slot.loading = true
  try {
    slot.clf = await pipeline('text-classification', name, { quantized: MODELS[index]!.quantized })
    console.log(`[ytbd] AI model ready: ${name}`)
  } catch (e) {
    console.warn(`[ytbd] AI model failed to load (${name}):`, e)
    slot.failed = true
  } finally {
    slot.loading = false
  }
  return slot.clf
}

export function warmupClassifier(): void {
  MODELS.forEach((_, i) => void loadSlot(i))
}

async function scoreSlot(index: number, text: string): Promise<number | null> {
  const clf = await loadSlot(index)
  if (!clf) return null

  const { isAI } = MODELS[index]!
  try {
    const raw = await (clf as Clf)(text, { truncation: true, max_length: 512 })
    const item: { label: string; score: number } = Array.isArray(raw) ? raw[0] : raw
    if (!item) return null
    const label = item.label.toUpperCase()
    return isAI(label) ? item.score : 1 - item.score
  } catch (e) {
    console.warn(`[ytbd] Scoring error (${MODELS[index]!.name}):`, e)
    return null
  }
}

export async function scoreAIText(text: string): Promise<AIDetectorResult> {
  const wordCount = text.trim().split(/\s+/).length
  if (wordCount < 8) return { score: 0, ready: false }

  // Run all models in parallel — whichever is ready contributes its score
  const scores = await Promise.all(MODELS.map((_, i) => scoreSlot(i, text)))
  const available = scores.filter((s): s is number => s !== null)

  if (available.length === 0) return { score: 0, ready: false }

  // Probabilistic OR: each model's evidence compounds independently
  const combined = 1 - available.reduce((acc, s) => acc * (1 - s), 1)
  console.log(`[ytbd] AI scores — slot0=${scores[0]?.toFixed(3)} slot1=${scores[1]?.toFixed(3)} combined=${combined.toFixed(3)} | "${text.slice(0, 60)}"`)
  return { score: combined, ready: true }
}

export function getAIWeight(text: string): number {
  const wordCount = text.trim().split(/\s+/).length
  return wordCount >= 50 ? 0.25 : 0.15
}
