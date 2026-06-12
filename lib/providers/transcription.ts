export interface TranscriptionSegment {
  start: number
  end: number
  text: string
  speaker?: string
}

export interface Speaker {
  id: string
  label: string
}

export interface TranscriptionResult {
  text: string
  segments: TranscriptionSegment[]
  speakers?: Speaker[]
  duration: number
  language?: string
}

export interface TranscriptionProvider {
  readonly name: string
  readonly supportedLanguages: string[]
  readonly supportsSpeakerDiarization: boolean
  transcribe(source: File | string): Promise<TranscriptionResult>
}
