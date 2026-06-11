// Runs in background.ts (Service Worker) only — never import in content.ts.
// Both models download from HuggingFace on first use and cache via Cache API.

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — package ships JS + JSDoc, no bundled .d.ts; skipLibCheck handles it
import { pipeline, env } from '@xenova/transformers'

// Disable local-model lookup — the extension has no /models/ directory.
;(env as Record<string, unknown>)['allowLocalModels'] = false

export interface AIDetectorResult {
  score: number   // 0–1, probability of AI-generated text
  ready: boolean  // false while both models are loading or unavailable
}

// ─── Model A: Hello-SimpleAI/chatgpt-detector-roberta ────────────────────────
// Trained on ChatGPT-3.5/4 outputs vs human text — catches modern LLM generations.
// Labels: 'ChatGPT' (AI) | 'Human'

// ─── Model B: Xenova/roberta-base-openai-detector ────────────────────────────
// Trained on GPT-2 outputs — catches simpler/cheaper generations common in
// engagement farm bots running cost-optimised models.
// Labels: 'Fake' (AI) | 'Real'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Clf = any

interface ClfState {
  clf: Clf | null
  loading: boolean
  failed: boolean
}

const modelA: ClfState = { clf: null, loading: false, failed: false }
const modelB: ClfState = { clf: null, loading: false, failed: false }

async function loadModel(state: ClfState, name: string): Promise<Clf | null> {
  if (state.clf) return state.clf
  if (state.failed || state.loading) return null

  state.loading = true
  try {
    state.clf = await pipeline('text-classification', name, { quantized: true })
    console.log(`[ytbd] AI model ready: ${name}`)
  } catch (e) {
    console.warn(`[ytbd] AI model failed to load (${name}):`, e)
    state.failed = true
  } finally {
    state.loading = false
  }
  return state.clf
}

async function scoreWithModel(
  state: ClfState,
  name: string,
  text: string,
  isAILabel: (label: string) => boolean,
): Promise<number | null> {
  const clf = await loadModel(state, name)
  if (!clf) return null

  try {
    const raw = await (clf as Clf)(text, { truncation: true, max_length: 512 })
    const item: { label: string; score: number } = Array.isArray(raw) ? raw[0] : raw
    if (!item) return null
    const label = item.label.toUpperCase()
    return isAILabel(label) ? item.score : 1 - item.score
  } catch (e) {
    console.warn(`[ytbd] Scoring error (${name}):`, e)
    return null
  }
}

export function warmupClassifier(): void {
  void loadModel(modelA, 'Hello-SimpleAI/chatgpt-detector-roberta')
  void loadModel(modelB, 'Xenova/roberta-base-openai-detector')
}

export async function scoreAIText(text: string): Promise<AIDetectorResult> {
  const wordCount = text.trim().split(/\s+/).length
  if (wordCount < 8) return { score: 0, ready: false }

  // Run both models in parallel — whichever is ready contributes its score
  const [scoreA, scoreB] = await Promise.all([
    scoreWithModel(
      modelA,
      'Hello-SimpleAI/chatgpt-detector-roberta',
      text,
      label => label === 'CHATGPT',
    ),
    scoreWithModel(
      modelB,
      'Xenova/roberta-base-openai-detector',
      text,
      label => label === 'FAKE',
    ),
  ])

  const available = [scoreA, scoreB].filter((s): s is number => s !== null)
  if (available.length === 0) return { score: 0, ready: false }

  // Probabilistic OR: independent evidence compounds naturally, result stays ≤ 1
  const combined = 1 - available.reduce((acc, s) => acc * (1 - s), 1)
  return { score: combined, ready: true }
}

export function getAIWeight(text: string): number {
  const wordCount = text.trim().split(/\s+/).length
  return wordCount >= 50 ? 0.25 : 0.15
}
