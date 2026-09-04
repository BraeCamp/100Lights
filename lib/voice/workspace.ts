// The workspace, by voice: which view is up, what is overlaid, how far it is
// zoomed, what snaps — and any command the editor's own palette offers.
//
// Brae: "look at more navigation options that could be wired into voice
// control." Most of what a hand does between two edits is navigation, and
// almost none of it could be said. The editor already lists its actions for
// the ⌘K palette (lib/commands.ts) with a label and keywords; matching what
// was said against that list gives the voice every one of them at once,
// including the ones added later.

import { foldName } from './resolve'
import { near } from './words'

export type WorkspaceView = 'arrangement' | 'session' | 'mixer'
const VIEW_WORDS: Record<string, WorkspaceView> = {
  arrangement: 'arrangement', arrangements: 'arrangement', arrange: 'arrangement', timeline: 'arrangement',
  session: 'session', sessions: 'session',
  mixer: 'mixer', mixers: 'mixer', faders: 'mixer',
}
export function viewOf(spoken: string): WorkspaceView | null {
  const words = foldName(spoken).split(' ')
  for (const w of words) if (VIEW_WORDS[w]) return VIEW_WORDS[w]
  return null
}

export type SnapChoice = 'off' | '1/16' | '1/8' | 'beat' | 'bar'
export function snapOf(spoken: string): SnapChoice | null {
  const t = ` ${foldName(spoken)} `
  if (/ (?:off|none|nothing|no|free|disable|disabled) /.test(t)) return 'off'
  if (/ (?:bars?|measures?) /.test(t)) return 'bar'
  if (/ (?:sixteenths?|16ths?|1 16|sixteenth notes?) /.test(t)) return '1/16'
  if (/ (?:eighths?|8ths?|1 8|eighth notes?|quavers?) /.test(t)) return '1/8'
  if (/ (?:beats?|quarters?|quarter notes?|crotchets?) /.test(t)) return 'beat'
  if (/ (?:on|enable|enabled|back on) /.test(t)) return '1/16'
  return null
}
export function snapLabel(s: SnapChoice): string {
  return s === 'off' ? 'off' : s === 'bar' ? 'bars' : s === 'beat' ? 'beats' : s === '1/8' ? 'eighths' : 'sixteenths'
}

// Mirrors OverlayKind in lib/daw-state (not imported: that module pulls the
// synth engine in, and this one is read by tests that must stay light).
export type OverlayChoice = 'none' | 'loading' | 'sync' | 'sections' | 'tempo' | 'key' | 'automation' | 'effects' | 'frozen' | 'loudness' | 'collab' | 'unused'
export const OVERLAY_LABEL: Record<OverlayChoice, string> = {
  none: 'Off', loading: 'Not loaded', sync: 'Not synced', sections: 'Other sections', tempo: 'Tempo changes', key: 'Out of key',
  automation: 'Automation', effects: 'Effects', frozen: 'Frozen', loudness: 'Loudness', collab: 'Collaborators', unused: 'Unused',
}
const OVERLAY_WORDS: [OverlayChoice, RegExp][] = [
  ['none', / (?:off|none|clear|cleared|nothing|no overlay|hide|remove|away) /],
  ['loading', / (?:loading|loaded|unloaded|ready|readiness|arrived) /],
  ['sync', / (?:sync|synced|syncing|unsynced|cloud|uploaded) /],
  ['sections', / (?:sections?|other sections|structure) /],
  ['tempo', / (?:tempo|tempos|bpm) /],
  ['key', / (?:key|keys|out of key|off key|scale|wrong notes) /],
  ['automation', / (?:automation|automated|lanes?) /],
  ['effects', / (?:effects?|fx|devices?) /],
  ['frozen', / (?:frozen|freeze|freezed) /],
  ['loudness', / (?:loudness|loud|quiet|levels?|lufs) /],
  ['collab', / (?:collab|collaborators?|people|who|users?|peers?) /],
  ['unused', / (?:unused|not used|never (?:played|used)|silent) /],
]
export function overlayOf(spoken: string): OverlayChoice | null {
  const t = ` ${foldName(spoken)} `
  for (const [kind, re] of OVERLAY_WORDS) if (re.test(t)) return kind
  return null
}

// ── The editor's own commands, by name ──────────────────────────────────────

export interface SpokenCommand { id: string; label: string; keywords?: string; group?: string }

const FILLER = new Set(['the', 'a', 'an', 'please', 'light', 'hey', 'can', 'could', 'would', 'you', 'me', 'my', 'to', 'of', 'for',
  'on', 'in', 'it', 'this', 'that', 'now', 'then', 'and', 'just', 'up', 'us', 'lets', 'let', 'go', 'ahead', 'okay', 'ok'])
const content = (s: string): string[] => foldName(s).split(' ').filter(w => w && !FILLER.has(w))
const same = (a: string, b: string): boolean => a === b || (a.length >= 4 && b.length >= 4 && Math.abs(a.length - b.length) <= 1 && near(a, b))

/**
 * Which command was named? Scored by how much of the command's label the
 * sentence says (most of it), and how much of the sentence the label and its
 * keywords account for (some of it) — so "hide the sidebar" finds "Hide the
 * sidebar" and "open the library" does not find "Open Sound Library".
 */
export function matchCommand(commands: SpokenCommand[], spoken: string): { command: SpokenCommand; score: number } | null {
  const said = content(spoken)
  if (!said.length) return null
  let best: { command: SpokenCommand; score: number } | null = null
  for (const c of commands) {
    const label = content(c.label)
    if (!label.length) continue
    const keys = content(c.keywords ?? '')
    const labelHit = label.filter(l => said.some(s => same(s, l))).length / label.length
    if (labelHit < 0.6) continue
    const covered = said.filter(s => label.some(l => same(s, l)) || keys.some(k => same(s, k))).length / said.length
    const score = labelHit * 0.7 + covered * 0.3
    if (!best || score > best.score) best = { command: c, score }
  }
  return best
}
