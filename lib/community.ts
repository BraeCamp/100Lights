// Client helpers for the community exchange: sharing and importing samples,
// presets, and recipes. Samples carry audio via R2; presets carry their
// folder's render specs (no blobs — notes re-render locally on demand);
// recipes carry the note pattern itself.

import { libraryGetAll, libraryAdd, type LibraryEntry, type LibraryCategory } from './sound-library'
import { libraryFulfill } from './default-samples'
import { getPresets, addPreset, type MidiPreset } from './midi-presets'
import { importRecipe, type StoredRecipeSpec } from './practice-recipes'
import type { MidiClip } from './daw-types'

export type CommunityKind = 'song' | 'sample' | 'preset' | 'recipe' | 'pack' | 'project'

export interface CommunityItem {
  id: string
  kind: CommunityKind
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
  reactions: Record<string, number>
  myReactions: string[]
}

export const COMMUNITY_TAGS = ['drums', 'melody', 'bass', 'vocals', 'lofi', 'electronic', 'hiphop', 'rock', 'jazz', 'ambient', 'pop', 'experimental'] as const

export interface ListOptions {
  kind?: string
  sort?: 'top' | 'new' | 'trending' | 'name'
  q?: string
  tag?: string
  author?: string
  /** Comma-separated LibraryCategory values (send a category group's members) */
  category?: string
  page?: number
}

export interface ListResult {
  items: CommunityItem[]
  hasMore: boolean
  total: number
  scale: 'small' | 'large'
  sortUsed: string
  stats: { items: number; authors: number }
}

export async function listCommunity(opts: ListOptions = {}): Promise<ListResult> {
  const qs = new URLSearchParams()
  if (opts.kind) qs.set('kind', opts.kind)
  if (opts.sort) qs.set('sort', opts.sort)  // omitted → the server's scale mode decides
  if (opts.q) qs.set('q', opts.q)
  if (opts.tag) qs.set('tag', opts.tag)
  if (opts.author) qs.set('author', opts.author)
  if (opts.category) qs.set('category', opts.category)
  if (opts.page) qs.set('page', String(opts.page))
  const res = await fetch(`/api/community?${qs}`)
  if (!res.ok) throw new Error(`list failed (${res.status})`)
  return await res.json() as ListResult
}

export async function getCommunityItem(id: string): Promise<CommunityItem | null> {
  const res = await fetch(`/api/community/${id}`)
  if (!res.ok) return null
  return (await res.json()).item as CommunityItem
}

export async function toggleReaction(id: string, emoji: string): Promise<Record<string, number>> {
  const res = await fetch(`/api/community/${id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'react', emoji }),
  })
  if (!res.ok) throw new Error('reaction failed')
  return (await res.json()).reactions
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

export interface SongMeta {
  bpm?: number
  key?: string
  durationSec?: number
  peaks?: number[]     // pre-rendered waveform (≈120 bars) so cards draw instantly
  tags?: string[]
}

/** Shares a rendered mix (from the export flow or a file) as a song. */
export async function shareSong(blob: Blob, name: string, description: string, meta: SongMeta = {}): Promise<string> {
  const baseType = (blob.type || 'audio/wav').split(';')[0]
  const ext = baseType === 'audio/wav' ? '.wav' : baseType === 'audio/webm' ? '.webm' : '.mp3'
  const presign = await fetch('/api/media/presign-upload', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: `song-${crypto.randomUUID()}${ext}`, contentType: baseType, mediaId: `community-song-${crypto.randomUUID()}`, size: blob.size }),
  })
  if (!presign.ok) throw new Error('upload not authorized')
  const { uploadUrl, key } = await presign.json() as { uploadUrl: string; key: string }
  const put = await fetch(uploadUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': baseType } })
  if (!put.ok) throw new Error('upload failed')
  const res = await fetch('/api/community', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'song', name, description, r2Key: key, payload: { contentType: baseType, ...meta } }),
  })
  if (!res.ok) throw new Error('share failed')
  return (await res.json()).id as string
}

/** Bundles several library samples into one importable pack. */
export async function sharePack(entries: LibraryEntry[], name: string, description: string, tags: string[] = []): Promise<string> {
  if (entries.length === 0) throw new Error('pick at least one sample')
  const samples: Array<{ name: string; category: string; duration: number; r2Key: string; contentType: string }> = []
  for (const raw of entries) {
    const entry = raw.audioBlob ? raw : await libraryFulfill(raw.id)
    if (!entry?.audioBlob) continue
    const blob = entry.audioBlob
    const baseType = (blob.type || 'audio/wav').split(';')[0]
    const presign = await fetch('/api/media/presign-upload', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: `pack-${crypto.randomUUID()}.wav`, contentType: baseType, mediaId: `community-pack-${crypto.randomUUID()}`, size: blob.size }),
    })
    if (!presign.ok) throw new Error('upload not authorized')
    const { uploadUrl, key } = await presign.json() as { uploadUrl: string; key: string }
    const put = await fetch(uploadUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': baseType } })
    if (!put.ok) throw new Error(`upload failed for ${entry.name}`)
    samples.push({ name: entry.name, category: entry.category, duration: entry.duration, r2Key: key, contentType: baseType })
  }
  if (samples.length === 0) throw new Error('none of the picked samples had audio')
  const res = await fetch('/api/community', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'pack', name, description, payload: { samples, tags } }),
  })
  if (!res.ok) throw new Error('share failed')
  return (await res.json()).id as string
}

/** Shares the whole arrangement as a remixable starter (audio resolves via r2Keys). */
export async function shareProjectStarter(dawProject: unknown, name: string, description: string, meta: { tempo?: number; key?: string; tracks?: number; clips?: number; tags?: string[] } = {}): Promise<string> {
  const res = await fetch('/api/community', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'project', name, description, payload: { dawProject, ...meta } }),
  })
  if (!res.ok) {
    if (res.status === 413) throw new Error('project too large to share as a starter')
    throw new Error('share failed')
  }
  return (await res.json()).id as string
}


export async function shareSample(entry: LibraryEntry, description: string, tags: string[] = []): Promise<void> {
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
    body: JSON.stringify({ kind: 'sample', name: entry.name, description, r2Key: key, payload: { category: entry.category, duration: fulfilled.duration, contentType: baseType, ...(tags.length ? { tags } : {}) } }),
  })
  if (!res.ok) throw new Error('share failed')
}

export async function sharePreset(preset: MidiPreset, description: string, tags: string[] = []): Promise<void> {
  const entries = (await libraryGetAll()).filter(e => e.folder === preset.folder && e.renderSpec)
  if (entries.length === 0) throw new Error('preset folder has no renderable notes to share')
  const res = await fetch('/api/community', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'preset', name: preset.name, description,
      payload: {
        preset: { name: preset.name, folder: preset.folder, loNote: preset.loNote, hiNote: preset.hiNote, category: preset.category, group: preset.group },
        entries: entries.map(e => ({ name: e.name, category: e.category, renderSpec: e.renderSpec, tags: e.tags })),
        ...(tags.length ? { tags } : {}),
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
      tagline: item.description ? `${item.description} — by ${item.authorName}` : `Shared by ${item.authorName}`,
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

  if (item.kind === 'pack') {
    const p = item.payload as { samples?: Array<{ name: string; category: string; duration: number }> }
    const samples = p.samples ?? []
    // Reference rows only — audio streams on first use and caches locally
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i]
      await libraryAdd({
        id: `community:${item.id}:${i}`,
        name: s.name,
        category: (s.category ?? 'other') as LibraryCategory,
        duration: s.duration ?? 1,
        addedAt: new Date().toISOString(),
        folder: item.name.slice(0, 40), parentFolder: 'Community',
        communityRef: { itemId: item.id, sampleIndex: i },
        authorName: item.authorName,
      })
    }
    void countDownload(item.id)
    return `${samples.length} sample${samples.length !== 1 ? 's' : ''} linked into your library under Community › ${item.name.slice(0, 40)}.`
  }

  if (item.kind === 'project') {
    // Starters open in the editor rather than importing into the library
    window.open(`/new?starter=${item.id}`, '_blank')
    void countDownload(item.id)
    return 'Opening the starter in a new studio tab…'
  }

  if (item.kind === 'song') {
    if (!item.r2Key) throw new Error('song has no audio key')
    const signed = await fetch(`/api/media/signed-url?key=${encodeURIComponent(item.r2Key)}`)
    if (!signed.ok) throw new Error('could not resolve song audio')
    const { url } = await signed.json() as { url: string }
    const blob = await (await fetch(url)).blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    const meta = (item.payload ?? {}) as { contentType?: string }
    a.download = `${item.name.replace(/[^a-z0-9_\-\s]/gi, '').trim() || 'song'}${meta.contentType === 'audio/webm' ? '.webm' : '.wav'}`
    a.click()
    URL.revokeObjectURL(a.href)
    void countDownload(item.id)
    return 'Song downloaded.'
  }

  // sample: a reference row — audio streams from the community on first use,
  // then caches locally. Import costs one tiny database row, not a download.
  if (!item.r2Key) throw new Error('sample has no audio key')
  const meta = (item.payload ?? {}) as { category?: string; duration?: number }
  await libraryAdd({
    id: `community:${item.id}`,
    name: item.name,
    category: (meta.category ?? 'other') as LibraryCategory,
    duration: meta.duration ?? 1,
    addedAt: new Date().toISOString(),
    folder: 'Community', parentFolder: 'Community',
    communityRef: { itemId: item.id },
    authorName: item.authorName,
  })
  void countDownload(item.id)
  return 'Linked into your sound library under Community.'
}
