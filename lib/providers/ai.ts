import type { OutputType } from '@/lib/types'

export interface GenerationOptions {
  transcript: string
  outputType: OutputType
  title?: string
  tone?: 'professional' | 'casual' | 'technical'
  additionalContext?: string
}

export interface GenerationResult {
  title: string
  content: string
  metadata?: Record<string, unknown>
}

export interface AIProvider {
  readonly name: string
  generate(options: GenerationOptions): Promise<GenerationResult>
  stream(options: GenerationOptions): AsyncGenerator<string>
}
