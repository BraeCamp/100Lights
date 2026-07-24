'use client'

/**
 * Cross-device sync for the NON-audio library: presets, drum kits, drum
 * patterns. Those live in localStorage (lib/midi-presets, lib/drum-presets);
 * this mirrors a user's OWN (non-builtIn) items to their account via
 * /api/library/items so they follow the account to other devices.
 *
 * Companion to the audio-sample sync inside lib/sound-library.ts. Everything is
 * best-effort — offline just means no sync, the local stores are untouched.
 *
 * To avoid an import cycle the stores reach this module via dynamic import
 * (push/delete on add/delete); this module statically imports the stores' merge
 * + list helpers. Merge-down writes localStorage directly (no re-push), so
 * there is no upload loop.
 */

import { getPresets, upsertSyncedPresets, type MidiPreset } from './midi-presets'
import { getKits, getPatterns, upsertSyncedKits, upsertSyncedPatterns, type DrumKit, type DrumPattern } from './drum-presets'

type ItemType = 'preset' | 'kit' | 'pattern'

let _userId: string | null = null

/** Called when the signed-in user is known (from sound-library's initLibrary).
 *  Pulls the account's synced items into this device, then pushes any local
 *  user items the server is missing. Runs once per user change. */
export function setLibraryUser(userId: string | null) {
  const changed = userId !== _userId
  _userId = userId
  if (userId && changed) void syncAll()
}

export async function pushLibraryItem(type: ItemType, id: string, name: string, data: unknown): Promise<void> {
  if (typeof window === 'undefined' || !_userId) return
  try {
    await fetch('/api/library/items', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, id, name, data }),
    })
  } catch { /* offline — resynced on next sign-in */ }
}

export async function deleteLibraryItem(id: string): Promise<void> {
  if (typeof window === 'undefined' || !_userId) return
  try { await fetch(`/api/library/items?id=${encodeURIComponent(id)}`, { method: 'DELETE' }) }
  catch { /* best-effort */ }
}

interface SyncedItem { id: string; type: ItemType; name: string; data: unknown }

export async function syncAll(): Promise<void> {
  if (typeof window === 'undefined' || !_userId) return
  try {
    const res = await fetch('/api/library/items')
    if (!res.ok) return
    const { items } = await res.json() as { items: SyncedItem[] }

    // Down: merge anything the account has that this device is missing.
    upsertSyncedPresets(items.filter(i => i.type === 'preset').map(i => i.data as MidiPreset))
    upsertSyncedKits(items.filter(i => i.type === 'kit').map(i => i.data as DrumKit))
    upsertSyncedPatterns(items.filter(i => i.type === 'pattern').map(i => i.data as DrumPattern))

    // Up: push local user items the server doesn't have yet (pre-sync creations).
    const serverIds = new Set(items.map(i => i.id))
    for (const p of getPresets().filter(p => !p.builtIn)) if (!serverIds.has(p.id)) void pushLibraryItem('preset', p.id, p.name, p)
    for (const k of getKits().filter(k => !k.builtIn)) if (!serverIds.has(k.id)) void pushLibraryItem('kit', k.id, k.name, k)
    for (const p of getPatterns().filter(p => !p.builtIn)) if (!serverIds.has(p.id)) void pushLibraryItem('pattern', p.id, p.name, p)
  } catch { /* offline — local stores untouched */ }
}
