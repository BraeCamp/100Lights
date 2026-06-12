import type { CfProjFile } from './project-serializer'

const key = (id: string) => `cf_autosave_${id}`

/** Write a snapshot to localStorage. Silently no-ops if storage is full. */
export function writeAutosave(id: string, project: CfProjFile): void {
  try {
    localStorage.setItem(key(id), JSON.stringify(project))
  } catch {
    // localStorage quota exceeded — don't crash the editor
  }
}

/** Read back a previously auto-saved snapshot, or null if none exists. */
export function readAutosave(id: string): CfProjFile | null {
  try {
    const raw = localStorage.getItem(key(id))
    return raw ? (JSON.parse(raw) as CfProjFile) : null
  } catch {
    return null
  }
}

/** Remove the autosave after a successful manual save or explicit dismiss. */
export function clearAutosave(id: string): void {
  localStorage.removeItem(key(id))
}
