// One table of what every key does in Beacon.
//
// Three keydown handlers used to each hold their own if-chain (the studio's
// global keys, the arrangement's, the piano roll's), the help panel kept a
// fourth, hand-written copy of all of them, and the ⌘K palette a fifth in its
// `shortcut` hints. They drifted: the help panel advertised `B` for the
// library and `I` for inspect, and only one of those keys did anything.
//
// Now the table is the truth. The handlers ask it what a keystroke means
// (`resolveKey`), the help panel is generated from it (`shortcutGroups`), the
// palette reads its hints from it (`keysFor`), and a test proves no two keys
// in one scope collide.
//
// Momentary latching, as Live does it: a key marked `momentary` toggles on
// press and — if it was HELD for at least half a second — toggles back on
// release. A tap latches (Tab flips to Session and stays), a hold peeks (hold
// Tab, glance at the session grid, let go, you are back). One key, both
// behaviours, no setting.

export type KeyScope = 'global' | 'arrangement' | 'roll' | 'knob'
export type KeyMode = 'music' | 'podcast'

export interface KeyBinding {
  /** Stable id the handlers switch on: 'transport.play'. */
  id: string
  /**
   * The chord, in Mac glyphs: 'Space', '⌘S', '⇧⌘Z', '⌘⌥B', '←', '0', 'H'.
   * ⌘ means Command on a Mac and Control elsewhere; the help panel renders
   * it either way.
   */
  keys: string
  /** Other chords that mean the same thing ('Backspace' beside 'Delete'). */
  also?: string[]
  scope: KeyScope
  /** The line in the help panel. */
  action: string
  /** The help panel heading it sits under. */
  group: string
  modes?: KeyMode[]
  /** Hold ≥ MOMENTARY_HOLD_MS and it toggles back on release. */
  momentary?: boolean
  /** The ⌘K palette command this key is a shortcut for, when there is one. */
  command?: string
  /** Shown in the help panel in place of `keys` — for '← / →' style pairs. */
  display?: string
  /** Not listed in the help panel (the second half of a displayed pair). */
  hidden?: boolean
}

export const MOMENTARY_HOLD_MS = 500

// ⚠️ Order matters within a scope only for readability; across scopes the
// handler's scope list decides (the arrangement asks for ['arrangement'] and
// the studio for ['global'], and the arrangement listens in the capture phase
// so its ← wins over the studio's ← when a clip is selected).
export const KEYMAP: KeyBinding[] = [
  // ── Transport & Global ─────────────────────────────────────────────────
  { id: 'transport.play', keys: 'Space', scope: 'global', group: 'Transport & Global', action: 'Play / Stop', command: 'audio.transport.play' },
  { id: 'transport.record', keys: 'R', scope: 'global', group: 'Transport & Global', action: 'Start / stop recording' },
  { id: 'transport.metronome', keys: 'M', scope: 'global', group: 'Transport & Global', action: 'Toggle metronome', command: 'audio.transport.metronome' },
  { id: 'transport.back', keys: '←', scope: 'global', group: 'Transport & Global', action: 'Move playhead ±1 beat (no clips selected)', display: '← / →' },
  { id: 'transport.forward', keys: '→', scope: 'global', group: 'Transport & Global', action: 'Move playhead ±1 beat (no clips selected)', hidden: true },
  { id: 'edit.undo', keys: '⌘Z', scope: 'global', group: 'Transport & Global', action: 'Undo', command: 'audio.edit.undo' },
  { id: 'edit.redo', keys: '⇧⌘Z', scope: 'global', group: 'Transport & Global', action: 'Redo', command: 'audio.edit.redo' },
  { id: 'file.save', keys: '⌘S', scope: 'global', group: 'Transport & Global', action: 'Save project', command: 'audio.save' },
  { id: 'edit.deleteClip', keys: 'Delete', also: ['Backspace'], scope: 'global', group: 'Transport & Global', action: 'Delete selected clips', command: 'audio.edit.deleteClip' },
  { id: 'edit.consolidate', keys: '⌘J', scope: 'global', group: 'Transport & Global', action: 'Consolidate — print a looping MIDI clip’s repeats as real notes' },
  { id: 'edit.deselect', keys: 'Esc', scope: 'global', group: 'Transport & Global', action: 'Clear every selection', command: 'audio.edit.deselect' },
  { id: 'view.session', keys: 'Tab', scope: 'global', group: 'Transport & Global', action: 'Session ⇄ Arrangement — tap to switch, hold to peek', modes: ['music'], momentary: true },
  // ⚠️ Not `B`. `B` is Draw Mode's key (Live’s pencil), and it was never wired
  // here anyway — the help panel advertised it for the library while nothing
  // listened. Live’s browser is ⌘⌥B; so is ours.
  { id: 'view.library', keys: '⌘⌥B', scope: 'global', group: 'Transport & Global', action: 'Show / hide the sound library — hold to peek', modes: ['music'], momentary: true, command: 'audio.library' },
  { id: 'view.draw', keys: 'B', scope: 'global', group: 'Transport & Global', action: 'Draw Mode — the pencil: tap to switch, hold to draw a run and let go', modes: ['music'], momentary: true },
  { id: 'view.inspect', keys: 'I', scope: 'global', group: 'Transport & Global', action: 'Inspect mode — hover anything for its name and details; hold to peek', momentary: true },
  { id: 'help.open', keys: 'H', also: ['?'], scope: 'global', group: 'Transport & Global', action: 'Open this help menu', display: 'H or ?' },
  { id: 'view.arrangementMixer', keys: '⌘⌥M', scope: 'global', group: 'Transport & Global', action: 'Show / hide the mixer under the arrangement', modes: ['music'] },
  { id: 'view.info', keys: '⌘⌥I', scope: 'global', group: 'Transport & Global', action: 'Show / hide the status bar — Info View and the selection readout' },
  // Live's Zoom Display. `=` is the unshifted key under `+` on every layout.
  { id: 'view.scaleUp', keys: '⌘=', also: ['⌘+'], scope: 'global', group: 'Transport & Global', action: 'Bigger interface — UI scale up 10 %', display: '⌘+' },
  { id: 'view.scaleDown', keys: '⌘-', scope: 'global', group: 'Transport & Global', action: 'Smaller interface — UI scale down 10 %', display: '⌘−' },
  { id: 'view.scaleReset', keys: '⌘0', scope: 'global', group: 'Transport & Global', action: 'Interface back to 100 %' },
  // The palette listens for its own chord (CommandPalette.tsx); it is listed
  // here so the help panel knows, and so nothing else can take ⌘K.
  { id: 'palette.open', keys: '⌘K', also: ['⇧⌘P'], scope: 'global', group: 'Transport & Global', action: 'Command palette — every action, by name' },

  // ── Detail area (the clip pane above the device pane) ───────────────────
  { id: 'detail.flip', keys: '⇧Tab', scope: 'global', group: 'Detail Area', action: 'Flip keyboard focus between the clip pane and the device pane' },
  { id: 'detail.clip', keys: '⌘⌥3', scope: 'global', group: 'Detail Area', action: 'Show / hide the clip pane' },
  { id: 'detail.device', keys: '⌘⌥4', scope: 'global', group: 'Detail Area', action: 'Show / hide the device pane' },
  { id: 'detail.full', keys: '⌘⌥E', scope: 'global', group: 'Detail Area', action: 'Detail area full size / back to normal' },

  // ── Arrangement — selection & editing ──────────────────────────────────
  { id: 'clip.nudgeLeft', keys: '←', scope: 'arrangement', group: 'Arrangement — selection & editing', action: 'Nudge selected clips by snap (⇧ = 1 beat)', display: '← / →' },
  { id: 'clip.nudgeRight', keys: '→', scope: 'arrangement', group: 'Arrangement — selection & editing', action: 'Nudge selected clips by snap (⇧ = 1 beat)', hidden: true },
  { id: 'clip.nudgeLeftBeat', keys: '⇧←', scope: 'arrangement', group: 'Arrangement — selection & editing', action: 'Nudge selected clips one beat', hidden: true },
  { id: 'clip.nudgeRightBeat', keys: '⇧→', scope: 'arrangement', group: 'Arrangement — selection & editing', action: 'Nudge selected clips one beat', hidden: true },
  { id: 'clip.trackUp', keys: '↑', scope: 'arrangement', group: 'Arrangement — selection & editing', action: 'Move selected clips to the track above / below', display: '↑ / ↓' },
  { id: 'clip.trackDown', keys: '↓', scope: 'arrangement', group: 'Arrangement — selection & editing', action: 'Move selected clips to the track above / below', hidden: true },
  { id: 'clip.copy', keys: '⌘C', scope: 'arrangement', group: 'Arrangement — selection & editing', action: 'Copy / paste clips or effects', display: '⌘C / ⌘V' },
  { id: 'clip.paste', keys: '⌘V', scope: 'arrangement', group: 'Arrangement — selection & editing', action: 'Copy / paste clips or effects', hidden: true },
  { id: 'clip.duplicate', keys: '⌘D', scope: 'arrangement', group: 'Arrangement — selection & editing', action: 'Duplicate selection after itself', command: 'audio.edit.duplicateClip' },
  { id: 'clip.selectAll', keys: '⌘A', scope: 'arrangement', group: 'Arrangement — selection & editing', action: 'Select all clips', command: 'audio.edit.selectAll' },
  { id: 'clip.deselect', keys: 'Esc', scope: 'arrangement', group: 'Arrangement — selection & editing', action: 'Clear selection' },
  { id: 'clip.split', keys: 'S', scope: 'arrangement', group: 'Arrangement — selection & editing', action: 'Split selected clip at playhead (hold S while box-dragging to splice a range)', command: 'audio.edit.splice' },
  { id: 'clip.activate', keys: '0', scope: 'arrangement', group: 'Arrangement — selection & editing', action: 'Deactivate / activate the selected clips — kept in place, dimmed, silent', command: 'audio.edit.toggleClipActive' },
  { id: 'clip.deleteEffects', keys: 'Delete', also: ['Backspace'], scope: 'arrangement', group: 'Arrangement — selection & editing', action: 'Delete selected effects' },

  // ── Arrangement — view & playback ──────────────────────────────────────
  { id: 'transport.home', keys: 'Home', scope: 'arrangement', group: 'Arrangement — view & playback', action: 'Jump playhead to start', command: 'audio.transport.top' },
  { id: 'loop.toggle', keys: 'L', scope: 'arrangement', group: 'Arrangement — view & playback', action: 'Toggle loop' },
  { id: 'loop.toSelection', keys: 'P', scope: 'arrangement', group: 'Arrangement — view & playback', action: 'Set loop region to selected clips', command: 'audio.transport.loopClip' },
  { id: 'edit.ripple', keys: 'G', scope: 'arrangement', group: 'Arrangement — view & playback', action: 'Toggle ripple edit' },
  { id: 'view.fit', keys: 'F', also: ['W'], scope: 'arrangement', group: 'Arrangement — view & playback', action: 'Fit the song to the window (optimise width)', display: 'F / W' },
  { id: 'view.fitHeight', keys: '⌥H', scope: 'arrangement', group: 'Arrangement — view & playback', action: 'Fit every track into the window (optimise height)' },
  { id: 'view.follow', keys: '⇧⌘F', scope: 'arrangement', group: 'Arrangement — view & playback', action: 'Follow the playhead — off / page / scroll' },
  { id: 'view.overview', keys: '⌘⌥O', scope: 'arrangement', group: 'Arrangement — view & playback', action: 'Show / hide the overview strip' },
  { id: 'snap.off', keys: '1', scope: 'arrangement', group: 'Arrangement — view & playback', action: 'Snap mode: Off / 1/16 / 1/8 / Beat / Bar', display: '1–5' },
  { id: 'snap.16th', keys: '2', scope: 'arrangement', group: 'Arrangement — view & playback', action: 'Snap to 1/16', hidden: true },
  { id: 'snap.8th', keys: '3', scope: 'arrangement', group: 'Arrangement — view & playback', action: 'Snap to 1/8', hidden: true },
  { id: 'snap.beat', keys: '4', scope: 'arrangement', group: 'Arrangement — view & playback', action: 'Snap to the beat', hidden: true },
  { id: 'snap.bar', keys: '5', scope: 'arrangement', group: 'Arrangement — view & playback', action: 'Snap to the bar', hidden: true },

  // ── Piano Roll ─────────────────────────────────────────────────────────
  { id: 'notes.deselect', keys: 'Esc', scope: 'roll', group: 'Piano Roll', action: 'Clear the note selection', modes: ['music'] },
  { id: 'notes.selectAll', keys: '⌘A', scope: 'roll', group: 'Piano Roll', action: 'Select all notes', modes: ['music'] },
  { id: 'notes.delete', keys: 'Delete', also: ['Backspace'], scope: 'roll', group: 'Piano Roll', action: 'Delete selected notes', modes: ['music'] },
  { id: 'notes.copy', keys: '⌘C', scope: 'roll', group: 'Piano Roll', action: 'Copy / cut / paste notes', modes: ['music'], display: '⌘C / ⌘X / ⌘V' },
  { id: 'notes.cut', keys: '⌘X', scope: 'roll', group: 'Piano Roll', action: 'Cut notes', modes: ['music'], hidden: true },
  { id: 'notes.paste', keys: '⌘V', scope: 'roll', group: 'Piano Roll', action: 'Paste notes at the playhead', modes: ['music'], hidden: true },
  { id: 'notes.duplicate', keys: '⌘D', scope: 'roll', group: 'Piano Roll', action: 'Duplicate selected notes after themselves', modes: ['music'] },
  { id: 'notes.quantize', keys: 'Q', scope: 'roll', group: 'Piano Roll', action: 'Quantize selected notes to the grid', modes: ['music'] },
  { id: 'notes.earlier', keys: '←', scope: 'roll', group: 'Piano Roll', action: 'Nudge selected notes by the grid', modes: ['music'], display: '← / →' },
  { id: 'notes.later', keys: '→', scope: 'roll', group: 'Piano Roll', action: 'Nudge selected notes by the grid', modes: ['music'], hidden: true },
  { id: 'notes.up', keys: '↑', scope: 'roll', group: 'Piano Roll', action: 'Transpose selected notes a semitone (⇧ = an octave)', modes: ['music'], display: '↑ / ↓' },
  { id: 'notes.down', keys: '↓', scope: 'roll', group: 'Piano Roll', action: 'Transpose selected notes a semitone (⇧ = an octave)', modes: ['music'], hidden: true },
  { id: 'notes.velUp', keys: '⌘↑', scope: 'roll', group: 'Piano Roll', action: 'Velocity of the selected notes up / down (⇧⌘ deviation, ⌘⌥ chance)', modes: ['music'], display: '⌘↑ / ⌘↓' },
  { id: 'notes.velDown', keys: '⌘↓', scope: 'roll', group: 'Piano Roll', action: 'Velocity down', modes: ['music'], hidden: true },
  { id: 'notes.devUp', keys: '⇧⌘↑', scope: 'roll', group: 'Piano Roll', action: 'Velocity deviation up', modes: ['music'], hidden: true },
  { id: 'notes.devDown', keys: '⇧⌘↓', scope: 'roll', group: 'Piano Roll', action: 'Velocity deviation down', modes: ['music'], hidden: true },
  { id: 'notes.chanceUp', keys: '⌘⌥↑', scope: 'roll', group: 'Piano Roll', action: 'Chance up', modes: ['music'], hidden: true },
  { id: 'notes.chanceDown', keys: '⌘⌥↓', scope: 'roll', group: 'Piano Roll', action: 'Chance down', modes: ['music'], hidden: true },
  { id: 'notes.fold', keys: 'F', scope: 'roll', group: 'Piano Roll', action: 'Fold — show only the pitches this clip uses', modes: ['music'] },
  { id: 'notes.foldScale', keys: 'G', scope: 'roll', group: 'Piano Roll', action: 'Fold to Scale — show only the notes of the scale (and any note outside it)', modes: ['music'] },
  { id: 'notes.highlightScale', keys: 'K', scope: 'roll', group: 'Piano Roll', action: 'Highlight Scale — tint the scale on the keys and the grid, the root more so', modes: ['music'] },
  { id: 'notes.focus', keys: 'N', scope: 'roll', group: 'Piano Roll', action: 'Focus — scroll to where the notes are', modes: ['music'] },
  { id: 'notes.group', keys: '⌘G', scope: 'roll', group: 'Piano Roll', action: 'Probability group for the selected notes — Play One, then Play All, then ungroup', modes: ['music'] },
  { id: 'notes.upOctave', keys: '⇧↑', scope: 'roll', group: 'Piano Roll', action: 'Transpose up an octave', modes: ['music'], hidden: true },
  { id: 'notes.downOctave', keys: '⇧↓', scope: 'roll', group: 'Piano Roll', action: 'Transpose down an octave', modes: ['music'], hidden: true },

  // ── Knobs (handled by the focused knob itself; listed so the help panel knows) ──
  { id: 'knob.next', keys: 'Tab', scope: 'knob', group: 'Knobs', action: 'Move between knobs — every knob takes keyboard focus' },
  { id: 'knob.nudge', keys: '↑', scope: 'knob', group: 'Knobs', action: 'Nudge the focused knob (hold Shift for fine steps)', display: '↑ / ↓' },
  { id: 'knob.coarse', keys: 'PageUp', scope: 'knob', group: 'Knobs', action: 'Coarse steps — a tenth of the knob at a time', display: 'PgUp / PgDn' },
  { id: 'knob.ends', keys: 'Home', scope: 'knob', group: 'Knobs', action: 'All the way down / all the way up', display: 'Home / End' },
  { id: 'knob.type', keys: 'Enter', scope: 'knob', group: 'Knobs', action: 'Type a value in — "800", "1.2k", "-6dB", "L30" all land' },
  { id: 'knob.reset', keys: 'Delete', scope: 'knob', group: 'Knobs', action: 'Reset the focused knob to its default (double-click does too)' },
]

// ── Parsing a chord ──────────────────────────────────────────────────────

export interface Chord {
  meta: boolean
  shift: boolean
  alt: boolean
  /** The key, normalised: a lower-case letter, a digit, or a name ('Space'). */
  key: string
}

const NAMED: Record<string, string> = {
  '←': 'ArrowLeft', '→': 'ArrowRight', '↑': 'ArrowUp', '↓': 'ArrowDown',
  'Esc': 'Escape', 'Del': 'Delete', 'Return': 'Enter', 'PgUp': 'PageUp', 'PgDn': 'PageDown',
  'Space': ' ',
}

export function parseChord(keys: string): Chord {
  let s = keys.trim()
  const chord: Chord = { meta: false, shift: false, alt: false, key: '' }
  for (;;) {
    if (s.startsWith('⌘')) { chord.meta = true; s = s.slice(1) }
    else if (s.startsWith('⇧')) { chord.shift = true; s = s.slice(1) }
    else if (s.startsWith('⌥')) { chord.alt = true; s = s.slice(1) }
    else if (/^(Cmd|Ctrl)\+/i.test(s)) { chord.meta = true; s = s.replace(/^(Cmd|Ctrl)\+/i, '') }
    else if (/^Shift\+/i.test(s)) { chord.shift = true; s = s.replace(/^Shift\+/i, '') }
    else if (/^(Alt|Opt|Option)\+/i.test(s)) { chord.alt = true; s = s.replace(/^(Alt|Opt|Option)\+/i, '') }
    else break
  }
  const named = NAMED[s]
  chord.key = named ?? (s.length === 1 ? s.toLowerCase() : s)
  return chord
}

/** The subset of KeyboardEvent the resolver reads — tests hand in plain objects. */
export interface KeyLike {
  key: string
  code?: string
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
}

function keyMatches(e: KeyLike, chord: Chord): boolean {
  const meta = !!(e.metaKey || e.ctrlKey)
  if (meta !== chord.meta || !!e.altKey !== chord.alt) return false
  // '?' needs Shift on most keyboards; a chord written as '?' means the
  // character, whichever modifier produced it.
  if (chord.key === '?') return e.key === '?'
  if (!!e.shiftKey !== chord.shift) return false
  const k = chord.key
  if (k.length === 1 && /[a-z]/.test(k)) {
    // Letters match by physical key first (⌥ on a Mac turns 'b' into '∫'),
    // then by character for layouts that move the letters.
    return e.code === `Key${k.toUpperCase()}` || e.key.toLowerCase() === k
  }
  if (/^\d$/.test(k)) return e.key === k || e.code === `Digit${k}`
  if (k === ' ') return e.key === ' ' || e.code === 'Space'
  return e.key === k || e.code === k
}

function bindingMatches(e: KeyLike, b: KeyBinding): boolean {
  if (keyMatches(e, parseChord(b.keys))) return true
  return !!b.also?.some(k => keyMatches(e, parseChord(k)))
}

/**
 * The momentary bindings whose KEY was just released, modifiers ignored —
 * by the time the letter of ⌘⌥B comes up, ⌘ and ⌥ usually already have.
 */
export function releasedMomentary(e: KeyLike, scopes: KeyScope[], mode: KeyMode = 'music'): KeyBinding[] {
  const out: KeyBinding[] = []
  for (const b of KEYMAP) {
    if (!b.momentary || !scopes.includes(b.scope)) continue
    if (b.modes && !b.modes.includes(mode)) continue
    const bare = { key: e.key, code: e.code }
    const hit = [b.keys, ...(b.also ?? [])].some(k => {
      const c = parseChord(k)
      return keyMatches(bare, { ...c, meta: false, shift: false, alt: false })
    })
    if (hit) out.push(b)
  }
  return out
}

/**
 * What a keystroke means in the given scopes, or null. Scopes are searched in
 * the order given, so a handler that owns two scopes lists the more specific
 * one first.
 */
export function resolveKey(e: KeyLike, scopes: KeyScope[], mode: KeyMode = 'music'): KeyBinding | null {
  for (const scope of scopes) {
    for (const b of KEYMAP) {
      if (b.scope !== scope) continue
      if (b.modes && !b.modes.includes(mode)) continue
      if (bindingMatches(e, b)) return b
    }
  }
  return null
}

/** The chord to show beside a palette command ('⌘S'), or undefined. */
export function keysFor(id: string): string | undefined {
  return KEYMAP.find(b => b.id === id)?.keys
}

/** The chord for a palette command id, when a key is bound to it. */
export function keysForCommand(commandId: string): string | undefined {
  return KEYMAP.find(b => b.command === commandId)?.keys
}

// ── The help panel ───────────────────────────────────────────────────────

export interface ShortcutRow { keys: string; action: string; id: string }
export interface ShortcutGroup { label: string; items: ShortcutRow[]; modes?: KeyMode[] }

/**
 * The key rows of the help panel, grouped in table order. A group is
 * mode-limited only when every binding in it is.
 */
export function shortcutGroups(): ShortcutGroup[] {
  const groups: ShortcutGroup[] = []
  for (const b of KEYMAP) {
    if (b.hidden) continue
    let g = groups.find(x => x.label === b.group)
    if (!g) { g = { label: b.group, items: [], modes: b.modes ? [...b.modes] : undefined }; groups.push(g) }
    else if (g.modes && (!b.modes || b.modes.some(m => !g!.modes!.includes(m)))) g.modes = undefined
    g.items.push({ id: b.id, keys: b.display ?? b.keys, action: b.action })
  }
  return groups
}

/**
 * Two bindings in one scope that answer to the same chord — the bug this
 * table exists to prevent. Empty when the table is sound.
 */
export function keymapConflicts(): Array<[string, string, string]> {
  const out: Array<[string, string, string]> = []
  const seen = new Map<string, string>()
  for (const b of KEYMAP) {
    for (const k of [b.keys, ...(b.also ?? [])]) {
      const c = parseChord(k)
      const sig = `${b.scope}|${c.meta ? 'M' : ''}${c.shift ? 'S' : ''}${c.alt ? 'A' : ''}|${c.key}`
      const prior = seen.get(sig)
      if (prior && prior !== b.id) out.push([prior, b.id, k])
      else seen.set(sig, b.id)
    }
  }
  return out
}

// ── Momentary latching ───────────────────────────────────────────────────

/**
 * Tracks held keys so a handler can tell a tap from a hold.
 *
 *   keydown → latch.down(id, now) → true on the FIRST press (run the toggle),
 *             false on auto-repeat (do nothing)
 *   keyup   → latch.up(id, now)   → true when it was held ≥ MOMENTARY_HOLD_MS
 *             (run the toggle again to come back), false for a tap
 */
export class MomentaryLatch {
  private downAt = new Map<string, number>()
  private holdMs: number
  constructor(holdMs = MOMENTARY_HOLD_MS) { this.holdMs = holdMs }
  down(id: string, now: number): boolean {
    if (this.downAt.has(id)) return false
    this.downAt.set(id, now)
    return true
  }
  up(id: string, now: number): boolean {
    const at = this.downAt.get(id)
    if (at == null) return false
    this.downAt.delete(id)
    return now - at >= this.holdMs
  }
  /** Forget everything — the window lost focus mid-hold, say. */
  clear() { this.downAt.clear() }
  isDown(id: string) { return this.downAt.has(id) }
}
