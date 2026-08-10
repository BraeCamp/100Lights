'use client'

// Shared transcription flow: local-first Whisper hybrid, with an optional escalation hook for tough
// audio. The standalone Captions app and the video module both drive their captions through this, so the
// "cheaper because local does the bulk" policy is defined in ONE place. The video module passes an
// `escalate` callback (its Deepgram-from-R2 path); the standalone app runs local-only ($0).
import { useCallback, useState } from 'react'
import type { EditCaption } from './caption-format'

export type TxStatus = 'idle' | 'loading' | 'transcribing' | 'done' | 'error'

export interface TxResult { captions: EditCaption[]; source: 'on-device' | 'AI'; lowFraction: number }

const toEdit = (c: { start: number; end: number; text: string; words?: EditCaption['words']; speaker?: string; confidence?: number }): EditCaption =>
  ({ id: crypto.randomUUID(), start: c.start, end: c.end, text: c.text, words: c.words, speaker: c.speaker, confidence: c.confidence, original: c.text, confirmed: false })

export function useTranscription() {
  const [status, setStatus] = useState<TxStatus>('idle')
  const [progress, setProgress] = useState(0)          // 0–100 model download, 101 = transcribing
  const [captions, setCaptions] = useState<EditCaption[]>([])
  const [lowFraction, setLowFraction] = useState(0)
  const [source, setSource] = useState<'on-device' | 'AI' | null>(null)
  const [error, setError] = useState('')

  const transcribe = useCallback(async (
    blob: Blob,
    opts: { escalate?: (reason: 'low-confidence' | 'local-failed') => Promise<TxResult | null>; escalateThreshold?: number } = {},
  ): Promise<TxResult | null> => {
    setStatus('loading'); setProgress(0); setError('')
    const finish = (r: TxResult) => { setCaptions(r.captions); setLowFraction(r.lowFraction); setSource(r.source); setStatus('done'); return r }
    try {
      const { transcribeLocally } = await import('./local-stt')
      setStatus('transcribing')
      const res = await transcribeLocally(blob, { onProgress: p => setProgress(p.status === 'transcribing' ? 101 : Math.min(100, Math.round(p.progress ?? 0))) })
      // Too much low-confidence AND an escalator is available → let the paid AI take it (video module).
      if (opts.escalate && res.lowConfidenceFraction > (opts.escalateThreshold ?? 0.35)) {
        const esc = await opts.escalate('low-confidence').catch(() => null)
        if (esc?.captions.length) return finish(esc)
      }
      return finish({ captions: res.captions.map(toEdit), source: 'on-device', lowFraction: res.lowConfidenceFraction })
    } catch (e) {
      if (opts.escalate) {   // local unavailable (no WebGPU/WASM, undecodable) → escalate if we can
        const esc = await opts.escalate('local-failed').catch(() => null)
        if (esc?.captions.length) return finish(esc)
      }
      setError(e instanceof Error ? e.message : 'Transcription failed. Try a shorter or clearer clip.')
      setStatus('error')
      return null
    }
  }, [])

  return { status, progress, captions, lowFraction, source, error, transcribe, setCaptions, setError, reset: () => { setStatus('idle'); setCaptions([]); setError('') } }
}
