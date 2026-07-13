// Client helpers for the community exchange: sharing and importing samples,
// presets, and recipes. Samples carry audio via R2; presets carry their
// folder's render specs (no blobs — notes re-render locally on demand);
// recipes carry the note pattern itself.

import { libraryGetAll, libraryAdd, getAudioDurationFromBlob, type LibraryEntry, type LibraryCategory } from './sound-library'
import { libraryFulfill } from './default-samples'
import { getPresets, addPreset, type MidiPreset } from './midi-presets'
import { importRecipe, type StoredRecipeSpec } from './practice-recipes'
import type { MidiClip } from './daw-types'

export interface CommunityItem {
  id: string
  kind: 'sample' | 'preset' | 'recipe'
  name: string
  description: string
  authorName: string
  votes: number
  downloads: number
  createdAt: string
  payload: unknown
  r2Key: string | null
  votedByMe: boolean
  mine: boolean
}

export async function listCommunity(kind?: string, sort: 'top' | 'new' = 'top'): Promise<CommunityItem[]> {
  const qs = new URLSearchParams({ sort, ...(kind ? { kind } : {}) })
  const res = await fetch(`/api/community?${qs}`)
  if (!res.ok) throw new Error(`list failed (${res.status})`)
  return (await res.json()).items as CommunityItem[]
}

export async function toggleVote(id: string): Promise<{ votes: number; votedByMe: boolean }> {
  const res = await fetch(`/api/community/${id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'vote' }),
  })
  if (!res.ok) throw new Error('vote failed')
  return res.json()
}

async function countDownload(id: string): Promise<void> {
  fetch(`/api/community/${id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'download' }),
  }).catch(() => {})
}

// ── Sharing ──────────────────────────────────────────────────────────────────

export async function shareSample(entry: LibraryEntry, description: string): Promise<void> {
  const fulfilled = entry.audioBlob ? entry : await libraryFulfill(entry.id)
  if (!fulfilled?.audioBlob) throw new Error('sample has no audio')
  const blob = fulfilled.audioBlob
  const baseType = (blob.type || 'audio/wav').split(';')[0]
  const presign = await fetch('/api/media/presign-upload', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: `community-${entry.id}.wav`, contentType: baseType, mediaId: `community-${crypto.randomUUID()}`, size: blob.size }),
  })
  if (!presign.ok) throw new Error('upload not authorized')
  const { uploadUrl, key } = await presign.json() as { uploadUrl: string; key: string }
  const put = await fetch(uploadUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': baseType } })
  if (!put.ok) throw new Error('upload failed')
  const res = await fetch('/api/community', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'sample', name: entry.name, description, r2Key: key, payload: { category: entry.category, duration: fulfilled.duration, contentType: baseType } }),
  })
  if (!res.ok) throw new Error('share failed')
}

export async function sharePreset(preset: MidiPreset, description: string): Promise<void> {
  const entries = (await libraryGetAll()).filter(e => e.folder === preset.folder && e.renderSpec)
  if (entries.length === 0) throw new Error('preset folder has no renderable notes to share')
  const res = await fetch('/api/community', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'preset', name: preset.name, description,
      payload: {
        preset: { name: preset.name, folder: preset.folder, loNote: preset.loNote, hiNote: preset.hiNote, category: preset.category, group: preset.group },
        entries: entries.map(e => ({ name: e.name, category: e.category, renderSpec: e.renderSpec, tags: e.tags })),
      },
    }),
  })
  if (!res.ok) throw new Error('share failed')
}

export async function shareRecipe(clip: MidiClip, name: string, description: string): Promise<void> {
  const spec = {
    trackName: name,
    instrument: { type: 'none' as const, params: {} },
    isDrumClip: clip.isDrumClip,
    durationBeats: clip.durationBeats,
    usePreset: !clip.isDrumClip,
    notes: clip.notes.map(n => ({ pitch: n.pitch, startBeat: n.startBeat, durationBeats: n.durationBeats, velocity: n.velocity })),
  }
  const res = await fetch('/api/community', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'recipe', name, description, payload: { spec, rootNote: clip.rootNote ?? 0 } }),
  })
  if (!res.ok) throw new Error('share failed')
}

// ── Importing ────────────────────────────────────────────────────────────────

export async function importItem(item: CommunityItem): Promise<string> {
  if (item.kind === 'recipe') {
    const p = item.payload as { spec: StoredRecipeSpec['spec'] }
    importRecipe({
      id: `community-${item.id}`,
      title: item.name,
      tagline: item.description || `Shared by ${item.authorName}`,
      annotation: item.description ? [item.description, `Shared by ${item.authorName}.`] : [`Shared by ${item.authorName}.`],
      spec: p.spec,
    })
    void countDownload(item.id)
    return 'Added to your Recipes tab — drag it from the sound library onto a track.'
  }

  if (item.kind === 'preset') {
    const p = item.payload as { preset: Omit<MidiPreset, 'id' | 'builtIn' | 'createdAt'>; entries: Array<Pick<LibraryEntry, 'name' | 'category' | 'renderSpec' | 'tags'>> }
    const folder = `${p.preset.folder}`
    const now = new Date().toISOString()
    for (const e of p.entries) {
      await libraryAdd({
        id: `community:${item.id}:${e.name}`,  // deterministic — re-import overwrites, never duplicates
        name: e.name, category: e.category as LibraryCategory, renderSpec: e.renderSpec,
        duration: e.renderSpec?.duration ?? 1, addedAt: now,
        folder, parentFolder: 'Community', ...(e.tags?.length ? { tags: e.tags } : {}),
      })
    }
    const already = getPresets().some(x => !x.builtIn && x.folder === folder && x.name === p.preset.name)
    if (!already) addPreset({ name: p.preset.name, folder, loNote: p.preset.loNote, hiNote: p.preset.hiNote, category: p.preset.category, group: p.preset.group })
    void countDownload(item.id)
    return 'Preset installed — pick it from any MIDI clip’s sound menu.'
  }

  // sample
  if (!item.r2Key) throw new Error('sample has no audio key')
  const signed = await fetch(`/api/media/signed-url?key=${encodeURIComponent(item.r2Key)}`)
  if (!signed.ok) throw new Error('could not resolve sample audio')
  const { url } = await signed.json() as { url: string }
  const blob = await (await fetch(url)).blob()
  const meta = (item.payload ?? {}) as { category?: string; duration?: number }
  await libraryAdd({
    id: `community:${item.id}`,
    name: item.name,
    category: (meta.category ?? 'other') as LibraryCategory,
    audioBlob: blob,
    duration: meta.duration ?? await getAudioDurationFromBlob(blob).catch(() => 1),
    addedAt: new Date().toISOString(),
    folder: 'Community', parentFolder: 'Community',
  })
  void countDownload(item.id)
  return 'Added to your sound library under Community.'
}
