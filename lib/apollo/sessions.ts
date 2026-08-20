'use client'
// Apollo sessions — every synth workspace is a saveable session, the same way
// Beacon and Prism projects work. A session is a normal `projects` row whose
// data carries modules:['apollo'] and the patch under data.apollo.patch, so
// the projects page lists them and /apollo?session=<id> opens them.
//
// Guests get the identical flow backed by localStorage only; signing in makes
// the same sessions start syncing (the local copy is always written first, so
// nothing is lost when a cloud call fails or the plan's project cap is hit).

import type { ApolloPatch } from './patch'

export interface SessionMeta { id: string; name: string; savedAt: string; cloud: boolean }
interface LocalEntry { id: string; name: string; savedAt: string; patch: ApolloPatch }

const LOCAL_KEY = 'apollo_sessions_local_v1'
const CURRENT_KEY = 'apollo_current_session_v1'
// The live working copy the provider already autosaves on every change.
export const WORKING_COPY_KEY = 'apollo_current_patch_v1'

// Set after a 401 so a signed-out visit doesn't hammer the API on every save.
let cloudOff = false

function localAll(): LocalEntry[] {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]') as LocalEntry[] } catch { return [] }
}
function localWrite(list: LocalEntry[]) {
  // Newest-first, capped — patches are a few KB each, so 40 stays well under quota.
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(list.slice(0, 40))) } catch { /* quota */ }
}
export function localPut(id: string, name: string, patch: ApolloPatch) {
  const list = localAll().filter(e => e.id !== id)
  list.unshift({ id, name, savedAt: new Date().toISOString(), patch })
  localWrite(list)
}
function localGet(id: string): LocalEntry | null {
  return localAll().find(e => e.id === id) ?? null
}

export function newSessionId(): string {
  try { return crypto.randomUUID() } catch { return 'ap-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36) }
}

export function getCurrent(): { id: string; name: string } | null {
  try {
    const raw = localStorage.getItem(CURRENT_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as { id?: string; name?: string }
    return v.id ? { id: v.id, name: v.name || 'Session' } : null
  } catch { return null }
}
export function setCurrent(meta: { id: string; name: string }) {
  try { localStorage.setItem(CURRENT_KEY, JSON.stringify(meta)) } catch { /* quota */ }
}

// A CfProjFile-compatible shell: _type/id/name pass the API's validation, the
// empty clips/media arrays keep list counts + trash purging happy.
function projFile(id: string, name: string, patch: ApolloPatch) {
  return {
    _type: '100lights-project', id, name,
    savedAt: new Date().toISOString(),
    clips: [], media: [], modules: ['apollo'],
    apollo: { patch },
  }
}

async function cloudSave(id: string, name: string, patch: ApolloPatch): Promise<boolean> {
  if (cloudOff) return false
  try {
    const r = await fetch('/api/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(projFile(id, name, patch)),
    })
    if (r.status === 401) { cloudOff = true; return false }
    return r.ok   // 403 project cap → stays a local session, keep trying is pointless this call but harmless later
  } catch { return false }
}

// Save everywhere it can reach: local first (never lost), then cloud.
export async function saveSession(id: string, name: string, patch: ApolloPatch): Promise<void> {
  localPut(id, name, patch)
  await cloudSave(id, name, patch)
}

export async function loadSession(id: string): Promise<{ name: string; patch: ApolloPatch } | null> {
  if (!cloudOff) {
    try {
      const r = await fetch(`/api/projects/${id}`)
      if (r.status === 401) cloudOff = true
      else if (r.ok) {
        const d = await r.json() as { name?: string; apollo?: { patch?: ApolloPatch } }
        if (d?.apollo?.patch) return { name: d.name || 'Session', patch: d.apollo.patch }
      }
    } catch { /* offline — fall through to local */ }
  }
  const local = localGet(id)
  return local ? { name: local.name, patch: local.patch } : null
}

export async function listSessions(): Promise<SessionMeta[]> {
  let cloudRows: SessionMeta[] = []
  if (!cloudOff) {
    try {
      const r = await fetch('/api/projects')
      if (r.status === 401) cloudOff = true
      else if (r.ok) {
        const rows = await r.json() as { id: string; name: string; savedAt: string; modules?: string[] | null; shared?: boolean }[]
        cloudRows = (Array.isArray(rows) ? rows : [])
          .filter(p => Array.isArray(p.modules) && p.modules.length === 1 && p.modules[0] === 'apollo' && !p.shared)
          .map(p => ({ id: p.id, name: p.name, savedAt: p.savedAt, cloud: true }))
      }
    } catch { /* offline */ }
  }
  const seen = new Set(cloudRows.map(m => m.id))
  const locals = localAll()
    .filter(e => !seen.has(e.id))
    .map(e => ({ id: e.id, name: e.name, savedAt: e.savedAt, cloud: false }))
  return [...cloudRows, ...locals].sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt))
}

export async function renameSession(id: string, name: string): Promise<void> {
  const local = localGet(id)
  if (local) localPut(id, name, local.patch)
  const cur = getCurrent()
  if (cur?.id === id) setCurrent({ id, name })
  if (!cloudOff) {
    try {
      await fetch(`/api/projects/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
    } catch { /* offline */ }
  }
}

export async function deleteSession(id: string): Promise<void> {
  localWrite(localAll().filter(e => e.id !== id))
  if (!cloudOff) {
    try { await fetch(`/api/projects/${id}`, { method: 'DELETE' }) } catch { /* offline */ }
  }
}
