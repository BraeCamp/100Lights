'use client'
// Account sync for Apollo user presets. localStorage (apollo_presets_v1) is
// the always-available source on each device; signed-in users additionally
// mirror the set to /api/apollo/presets so patches follow the account.
//
// Merge policy: UNION by name, local wins conflicts (the device you're on
// holds your latest intent), then the union is pushed back. Signed-out (401)
// is a silent no-op — everything keeps working from localStorage.

export interface UserPreset { name: string; json: string }

const LS_PRESETS = 'apollo_presets_v1'
let cloudOff = false

function loadLocal(): UserPreset[] {
  try { return JSON.parse(localStorage.getItem(LS_PRESETS) || '[]') as UserPreset[] } catch { return [] }
}
function saveLocal(list: UserPreset[]) {
  try { localStorage.setItem(LS_PRESETS, JSON.stringify(list)) } catch { /* quota */ }
}

/** Pull the account set, merge with local (local wins by name), persist both
 * ways. Returns the merged list, or null when signed out / offline. */
export async function syncApolloPresets(): Promise<UserPreset[] | null> {
  if (cloudOff) return null
  try {
    const res = await fetch('/api/apollo/presets')
    if (res.status === 401) { cloudOff = true; return null }
    if (!res.ok) return null
    const remote = await res.json() as UserPreset[]
    const local = loadLocal()
    const names = new Set(local.map(p => p.name))
    const merged = [...local, ...remote.filter(p => p?.name && !names.has(p.name))]
    saveLocal(merged)
    void fetch('/api/apollo/presets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ presets: merged }),
    }).catch(() => { /* offline */ })
    return merged
  } catch { return null }
}

/** Push one preset (fire-and-forget) — call after a local save. */
export function pushApolloPreset(preset: UserPreset): void {
  if (cloudOff) return
  void fetch('/api/apollo/presets', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ presets: [preset] }),
  }).then(r => { if (r.status === 401) cloudOff = true }).catch(() => { /* offline */ })
}

/** Remove one preset from the account set (fire-and-forget). */
export function deleteApolloPreset(name: string): void {
  if (cloudOff) return
  void fetch('/api/apollo/presets', {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  }).catch(() => { /* offline */ })
}
