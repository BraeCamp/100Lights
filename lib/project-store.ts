import type { Caption, Output, ContentType } from '@/lib/types'

export interface StoredProject {
  id: string
  name: string
  contentType: ContentType
  createdAt: string
  duration?: number
  captions: Caption[]
  outputs: Output[]
}

const STORE_KEY = 'cf_projects'

function read(): Record<string, StoredProject> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(STORE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function write(data: Record<string, StoredProject>) {
  window.localStorage.setItem(STORE_KEY, JSON.stringify(data))
}

export function saveProject(project: StoredProject) {
  const all = read()
  all[project.id] = project
  write(all)
}

export function loadProject(id: string): StoredProject | null {
  return read()[id] ?? null
}

export function listProjects(): StoredProject[] {
  return Object.values(read()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )
}
