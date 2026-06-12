import type { TranscriptionProvider, TranscriptionResult } from '@/lib/providers/transcription'

interface DeepgramUtterance {
  start: number
  end: number
  transcript: string
  speaker?: number
}

interface DeepgramResponse {
  metadata: { duration: number }
  results: { utterances: DeepgramUtterance[] }
}

export function createDeepgramProvider(apiKey: string): TranscriptionProvider {
  return {
    name: 'Deepgram',
    supportedLanguages: ['en', 'es', 'fr', 'de', 'ja', 'ko', 'pt', 'ru', 'zh'],
    supportsSpeakerDiarization: true,

    async transcribe(source: File | string): Promise<TranscriptionResult> {
      if (typeof source === 'string') {
        throw new Error('URL-based transcription not yet implemented')
      }

      const response = await fetch(
        'https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&utterances=true&diarize=true&punctuate=true',
        {
          method: 'POST',
          headers: {
            Authorization: `Token ${apiKey}`,
            'Content-Type': source.type || 'audio/mpeg',
          },
          body: await source.arrayBuffer(),
        }
      )

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body?.err_msg ?? `Deepgram returned ${response.status}`)
      }

      const data: DeepgramResponse = await response.json()
      const utterances = data.results?.utterances ?? []

      const segments = utterances.map((u) => ({
        start: u.start,
        end: u.end,
        text: u.transcript.trim(),
        speaker: u.speaker !== undefined ? `Speaker ${u.speaker + 1}` : undefined,
      }))

      return {
        text: segments.map((s) => s.text).join(' '),
        segments,
        duration: data.metadata.duration,
      }
    },
  }
}
