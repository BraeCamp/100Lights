'use client'
// ── Say several things, then decide ─────────────────────────────────────────
//
// Brae: "Can we have it collect executable commands and I can command it to read
// back the commands that I gave it and it executes when I say 'Execute' or 'Go
// ahead'. This will be prompted by the machine by having it ask 'Do you want to
// implement these changes?'"
//
// Every command up to now happened the instant it was understood, which is right
// for "stop" and wrong for the way people actually work through an idea. You
// describe three changes, hear them back, and then decide — and if the second
// one came out wrong you find out before it has been done rather than after.
//
// It also fixes something else. The studio has been asking to be addressed
// before each command, because a held-open microphone that acts on whatever it
// hears is dangerous. A queue changes that bargain: collecting is cheap and
// reversible, so it can afford to collect freely and ask once at the end. The
// name is needed to start collecting, not to add to the list.
//
// The control words live here, apart from the command registry, because they
// are about the CONVERSATION rather than about the song. "Execute" is not a
// thing you can do to a track.

import type { VoiceCall } from './execute-music'

export interface QueuedCommand {
  /** What was said. */
  text: string
  /** What it will do, in the studio's own words — the read-back. */
  say: string
  /** Resolved when it was collected; re-planned when it is run, because the
   *  project may have moved underneath it in between. */
  calls: VoiceCall[]
}

export type QueueControl =
  /** Carry out everything collected. */
  | 'run'
  /** Say the list back. */
  | 'read'
  /** Throw the list away. */
  | 'clear'
  /** Start collecting instead of acting immediately. */
  | 'collect'
  /** Go back to acting immediately. */
  | 'immediate'

const RUN = [
  'execute', 'go ahead', 'do it', 'run it', 'run them', 'make it so', 'implement',
  'apply', 'apply them', 'yes do it', 'commit', 'send it',
]
const READ = [
  'read back', 'read them back', 'read it back', 'read them', 'what do you have',
  'what have i got', 'what have you got', 'list them', 'what is queued',
  'what did i say', 'recap',
]
const CLEAR = [
  'clear the list', 'clear them', 'clear the queue', 'forget it', 'forget them',
  'cancel them', 'throw them away', 'scrap it', 'scrap them',
]
const COLLECT = [
  'collect commands', 'collect them', 'start collecting', 'batch mode',
  'queue them', 'queue commands', 'hold them', 'wait for me',
]
const IMMEDIATE = [
  'stop collecting', 'act immediately', 'run as i go', 'no more collecting',
  'immediate mode',
]

/** Normalised for matching: lower case, punctuation gone, spaces collapsed. */
function flat(text: string): string {
  return ` ${String(text ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()} `
}

/**
 * Is this about the queue rather than about the song?
 *
 * Matched on whole phrases, so "execute" is a control and "execute the plan" is
 * not mistaken for one — and, more importantly, so a track called Apply or a
 * clip called Commit cannot turn an ordinary command into a queue control.
 *
 * Null means it is not a control at all, which is the common case.
 */
export function readQueueControl(text: string): QueueControl | null {
  const t = flat(text)
  if (!t.trim()) return null
  // Longest sets first: "stop collecting" must not be read as "collect".
  for (const [phrases, control] of [
    [IMMEDIATE, 'immediate'], [COLLECT, 'collect'], [CLEAR, 'clear'],
    [READ, 'read'], [RUN, 'run'],
  ] as const) {
    if (phrases.some(p => t.includes(` ${p} `))) return control
  }
  return null
}

/**
 * How the studio offers to carry the list out.
 *
 * His words, because they are the right ones: it is asking permission for a
 * batch of changes, not announcing that it is about to act.
 */
export function askToImplement(queue: QueuedCommand[]): string {
  const n = queue.length
  return `${n} change${n === 1 ? '' : 's'} ready. Do you want to implement ${n === 1 ? 'it' : 'them'}?`
}

/**
 * The list, said back.
 *
 * Numbered, because the point of hearing it is to be able to say which one is
 * wrong, and "the second one" needs a second one to exist out loud.
 */
export function readBack(queue: QueuedCommand[]): string {
  if (!queue.length) return 'Nothing collected yet.'
  return queue.map((q, i) => `${i + 1}. ${q.say || q.text}`).join(' ')
}

/** What to say once they have run. */
export function reportRun(done: number, failed: string[]): string {
  const ran = `${done} change${done === 1 ? '' : 's'} made.`
  if (!failed.length) return ran
  return `${ran} ${failed.length} could not be done: ${failed.join('; ')}`
}
