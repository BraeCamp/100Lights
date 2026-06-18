export type ContentType = 'video' | 'audio' | 'title' | 'lut'
export type OutputType = 'article' | 'blog_post' | 'show_notes' | 'clips' | 'transcript' | 'summary' | 'youtube_desc' | 'social_caption' | 'email_newsletter' | 'key_quotes'

export interface ChapterMarker {
  id: string
  time: number   // seconds from start of source
  title: string
}
export type ProjectStatus = 'uploading' | 'processing' | 'completed' | 'error'
export type StepStatus = 'pending' | 'running' | 'completed' | 'error'

export interface Caption {
  start: number   // seconds from start of source file
  end: number
  text: string
  speaker?: string
}

export interface Clip {
  id: string
  title: string
  start: number   // seconds from start of source file
  end: number
  reason: string  // why the AI selected this moment
  captions: Caption[]
}

export interface PipelineStep {
  id: string
  label: string
  description: string
  status: StepStatus
  progress: number
  detail?: string
}

export interface Output {
  id: string
  type: OutputType
  title: string
  content: string
  wordCount?: number
  createdAt: Date
  captions?: Caption[]  // populated for 'transcript' outputs
  clips?: Clip[]        // populated for 'clips' outputs
}

export interface Project {
  id: string
  name: string
  fileName?: string
  contentType: ContentType
  status: ProjectStatus
  createdAt: Date
  duration?: number
  pipeline: PipelineStep[]
  outputs: Output[]
  captions?: Caption[]
}
