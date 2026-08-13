// Audio + text embeddings via ImageBind on Replicate. ImageBind maps audio, text (and images) into
// ONE 1024-dim space, so a text prompt ("dreamy dark synthpop") can retrieve sonically-similar
// tracks. Needs REPLICATE_API_TOKEN with billing (predictions 402 without credit).
import { createPrediction, getPrediction } from '@/lib/replicate'

const IMAGEBIND_VERSION = '0383f62e173dc821ec52663ed22a076d9c970549c209666ac3db181618b7a304'

export interface EmbedResult { vector: number[] | null; error?: 'not_configured' | 'no_credit' | 'failed' }

async function runEmbed(input: Record<string, unknown>): Promise<EmbedResult> {
  if (!process.env.REPLICATE_API_TOKEN) return { vector: null, error: 'not_configured' }
  try {
    let p = await createPrediction(IMAGEBIND_VERSION, input)   // Prefer: wait=60 → often already done
    for (let i = 0; i < 20 && (p.status === 'starting' || p.status === 'processing'); i++) {
      await new Promise(r => setTimeout(r, 2500))
      p = await getPrediction(p.id)
    }
    if (p.status === 'succeeded' && Array.isArray(p.output)) return { vector: (p.output as number[]).map(Number) }
    return { vector: null, error: 'failed' }
  } catch (e) {
    // 402 = Replicate account has no credit.
    if (/\b402\b/.test(String(e))) return { vector: null, error: 'no_credit' }
    return { vector: null, error: 'failed' }
  }
}

export const embedText = (text: string) => runEmbed({ modality: 'text', text_input: text })
export const embedAudio = (url: string) => runEmbed({ modality: 'audio', input: url })
