// Check-out / check-in of a Beacon track item into standalone Apollo.
//
// The model is deliberately NOT live (Brae, 2026-08-21): Apollo takes custody
// of an item, you develop it there with the transport running, and the changes
// land back in Beacon when you check it in. Two surfaces editing one clip in
// real time is the kind of thing that silently loses work; a check-out is
// legible — you can see the item is out, and exactly one place owns it.
//
// What travels: the NOTES and the SOUND (the instrument — Apollo patch, or a
// preset/sample reference). Deliberately NOT the track's FX chain or its
// automation: those stay in Beacon and keep belonging to the arrangement.
// Apollo can still MONITOR through a translated copy of the track's effects
// (see monitorChain) so the item is auditioned in context, but that copy is
// never edited and never travels back.

import type { DawProject, MidiClip, MidiNote, TrackInstrument } from '@/lib/daw-types'
import type { ApolloPatch, ClipConfig, ClipNote } from './patch'

export const CHECKOUT_LS_KEY = '100lights-apollo-checkout-v1'

export interface ApolloCheckout {
  id: string
  /** Where it came from, so check-in can find its way home. */
  projectId: string
  projectName: string
  trackId: string
  trackName: string
  clipId: string
  clipName: string
  /** Musical context the item was written against. */
  bpm: number
  lengthBeats: number
  /** The item itself. */
  notes: ClipNote[]
  /** The sound: an Apollo patch when the track already has one, otherwise the
   *  track instrument to translate on arrival. */
  patch: ApolloPatch | null
  instrument: TrackInstrument | null
  /** Monitor-only: the track's FX translated to Apollo units, so the item can
   *  be heard in context. Never edited here, never written back. */
  monitorChain: unknown[] | null
  checkedOutAt: string
  /** Set on check-in so Beacon knows the item came home. */
  returnedAt?: string
}

// ── conversions ─────────────────────────────────────────────────────────────
// Beacon stores notes in beats with a pitch; Apollo's clip uses the same idea
// with different field names. Keep both directions here so the mapping lives
// in exactly one place.

export function notesToApollo(notes: MidiNote[]): ClipNote[] {
  return notes.map(n => ({
    start: n.startBeat,
    len: n.durationBeats,
    note: n.pitch,
    vel: (n.velocity ?? 100) / 127,
    chance: 1,
  }))
}

export function notesFromApollo(notes: ClipNote[]): MidiNote[] {
  return notes.map(n => ({
    id: crypto.randomUUID(),
    pitch: Math.round(n.note),
    startBeat: n.start,
    durationBeats: n.len,
    velocity: Math.max(1, Math.min(127, Math.round((n.vel ?? 0.8) * 127))),
  }))
}

/** Build the payload for an item leaving Beacon. */
export function buildCheckout(project: DawProject, clip: MidiClip): ApolloCheckout | null {
  const track = project.tracks.find(t => t.id === clip.trackId)
  if (!track) return null
  const instrument = track.instrument ?? null
  const patch = instrument?.type === 'apollo' ? (instrument.params as unknown as ApolloPatch) : null
  return {
    id: crypto.randomUUID(),
    projectId: project.id ?? 'local',
    projectName: project.name ?? 'Untitled',
    trackId: track.id,
    trackName: track.name,
    clipId: clip.id,
    clipName: clip.name,
    bpm: project.tempo,
    lengthBeats: clip.durationBeats,
    notes: notesToApollo(clip.notes),
    patch,
    instrument: patch ? null : instrument,
    monitorChain: null,   // filled by the caller, which can reach translateChain
    checkedOutAt: new Date().toISOString(),
  }
}

/** The Apollo clip an arriving checkout becomes. */
export function checkoutToClip(co: ApolloCheckout): ClipConfig {
  return {
    id: crypto.randomUUID(),
    name: `${co.trackName} · ${co.clipName}`,
    lengthBeats: Math.max(1, co.lengthBeats),
    notes: co.notes,
    automation: [],
  }
}

// ── storage ─────────────────────────────────────────────────────────────────
// Local-first, same convention as the Apollo→Beacon seed. A single slot: one
// item is checked out at a time, which keeps the "who owns this" question
// answerable at a glance.

export function readCheckout(): ApolloCheckout | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(CHECKOUT_LS_KEY)
    return raw ? JSON.parse(raw) as ApolloCheckout : null
  } catch { return null }
}

export function writeCheckout(co: ApolloCheckout | null): void {
  if (typeof window === 'undefined') return
  try {
    if (co) localStorage.setItem(CHECKOUT_LS_KEY, JSON.stringify(co))
    else localStorage.removeItem(CHECKOUT_LS_KEY)
  } catch { /* storage full or blocked — the item stays in Beacon */ }
}

/** True when this clip is the one currently checked out. */
export function isCheckedOut(co: ApolloCheckout | null, clipId: string): boolean {
  return !!co && !co.returnedAt && co.clipId === clipId
}
