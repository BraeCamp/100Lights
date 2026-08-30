'use client'
// ── Interpreting a sentence, rather than matching one ───────────────────────
//
// Brae: "The voice detection is pretty bad... Can we have the machine interpret
// sentences?"
//
// Those two are the same problem. The first resolver matched whole utterances
// against anchored patterns — /^(restart|start over|from the top)$/ — which
// works when the transcript is perfect and fails completely when it is not. And
// a transcript is never perfect: it arrives with a filler word in front ("okay,
// start from the top"), a politeness on the end ("play it please"), a swallowed
// article, or a homophone. Every one of those turns an exact match into no
// match, and no match into a paid round trip that then fails on credits.
//
// So: stop matching, start reading. Throw away the words that carry no meaning,
// find the VERB, and take the numbers and names near it. That is far more
// forgiving of a bad transcript, because a bad transcript usually keeps the
// content words and mangles the small ones — "restart" survives, "could you" was
// never load-bearing.
//
// It is deliberately not clever. It knows a fixed set of intents and looks for
// evidence of each; anything it cannot place, it declines and hands on. The rule
// stays what it always was: a wrong local answer is worse than a slow correct
// one.

import { findByName, spokenNumber } from './resolve'
import type { VoiceCall } from './execute-music'

export interface Interpretation {
  calls: VoiceCall[]
  confidence: number
  matched: string
  needsName: boolean
}

const NOTHING: Interpretation = { calls: [], confidence: 0, matched: 'none', needsName: false }

/**
 * Words that carry no instruction.
 *
 * Politeness, hedging, and the noises a transcript picks up around a command.
 * Removing them first means "hey, could you please just stop it" and "stop"
 * reach the same place — which is the whole point, since people do not speak
 * the second one.
 */
const FILLER = new Set([
  'hey', 'ok', 'okay', 'um', 'uh', 'er', 'please', 'could', 'would', 'can', 'will',
  'you', 'i', 'want', 'need', 'like', 'just', 'now', 'then', 'and', 'so', 'lets',
  "let's", 'let', 'us', 'the', 'a', 'an', 'my', 'it', 'its', "it's", 'this', 'that',
  'to', 'for', 'of', 'on', 'at', 'in', 'be', 'is', 'are', 'do', 'does', 'did',
  'light', 'lights', 'beacon', 'thanks', 'thank',
  // Trailing address. "mute the pad for me" left "me" attached to the name, so
  // the lookup asked for a track called "pad me" and found nothing.
  'me', 'there', 'here',
])

/** Split into meaningful words. Punctuation and case are noise here. */
export function contentWords(sentence: string): string[] {
  return String(sentence ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(w => !FILLER.has(w))
}

/** The first number anywhere in the sentence, spoken or written. */
function firstNumber(words: string[]): number | null {
  for (const w of words) {
    const n = spokenNumber(w)
    if (n != null) return n
  }
  return null
}

/** Does the sentence contain this word, or one a letter away from it? A
 *  transcript that heard "loup" for "loop" should still find the intent. */
function has(words: string[], ...targets: string[]): boolean {
  for (const t of targets) {
    for (const w of words) {
      if (w === t) return true
      if (t.length >= 4 && Math.abs(w.length - t.length) <= 1 && near(w, t)) return true
    }
  }
  return false
}

/** One edit apart, no more. */
function near(a: string, b: string): boolean {
  let i = 0, j = 0, edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue }
    if (++edits > 1) return false
    if (a.length > b.length) i++
    else if (b.length > a.length) j++
    else { i++; j++ }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

export interface InterpretContext {
  tracks: { id: string; name?: string }[]
}

/**
 * Read a sentence and produce commands, or decline.
 *
 * Ordered by how specific the evidence is: a sentence naming a track and a
 * mixer verb is a mixer command even if it also contains "play", because
 * "play the pad louder" is not the transport.
 */
export function interpret(sentence: string, ctx: InterpretContext): Interpretation {
  const w = contentWords(sentence)
  if (!w.length) return NOTHING
  const n = firstNumber(w)

  // ── Mixer, first ─────────────────────────────────────────────────────────
  // Checked before transport because these sentences often contain a transport
  // word by accident, and a named track is much stronger evidence of intent
  // than a loose verb.
  {
    const verb = has(w, 'mute') ? 'mute'
      : has(w, 'unmute') ? 'unmute'
        : has(w, 'solo') ? 'solo'
          : has(w, 'unsolo') ? 'unsolo'
            : null
    if (verb) {
      // The track name is whatever is left once the verb and any number are
      // taken out — which is how "mute the bass two track" still finds "Bass 2".
      const rest = w.filter(x => !has([x], verb) && x !== 'track').join(' ')
      const hit = rest ? findByName(rest, ctx.tracks) : null
      if (hit && hit.score >= 0.6) {
        const input: Record<string, unknown> = { target: { name: hit.item.name } }
        if (verb === 'mute') input.muted = true
        else if (verb === 'unmute') input.muted = false
        else input.solo = verb === 'solo'
        return {
          calls: [{ name: 'set_track', input }],
          confidence: Math.min(0.93, 0.55 + hit.score * 0.38),
          matched: `set_track.${verb}`,
          needsName: true,
        }
      }
      // A mixer verb with no findable track is exactly the ambiguity the
      // assistant should ask about — declining here is the right answer.
      return NOTHING
    }
  }

  // Volume, as an absolute percentage. Relative moves ("a bit louder") are
  // still declined: how much "a bit" is has not been decided.
  if (n != null && n >= 0 && n <= 100 && has(w, 'percent', 'volume', 'level')) {
    const rest = w.filter(x => !/^\d+$/.test(x) && !has([x], 'percent', 'volume', 'level', 'set', 'put')).join(' ')
    const hit = rest ? findByName(rest, ctx.tracks) : null
    if (hit && hit.score >= 0.6) {
      return {
        calls: [{ name: 'set_track', input: { target: { name: hit.item.name }, volume: n } }],
        confidence: Math.min(0.9, 0.5 + hit.score * 0.38),
        matched: 'set_track.volume', needsName: true,
      }
    }
  }

  // ── Tempo ────────────────────────────────────────────────────────────────
  if (n != null && n >= 20 && n <= 300 && has(w, 'tempo', 'bpm')) {
    return {
      calls: [{ name: 'set_tempo', input: { bpm: n } }],
      confidence: 0.93, matched: 'set_tempo', needsName: false,
    }
  }

  // ── Loop ─────────────────────────────────────────────────────────────────
  if (has(w, 'loop', 'looping')) {
    if (has(w, 'off', 'stop', 'disable')) {
      return {
        calls: [{ name: 'set_loop_region', input: { enabled: false } }],
        confidence: 0.92, matched: 'set_loop_enabled', needsName: false,
      }
    }
    const nums = w.map(x => spokenNumber(x)).filter((x): x is number => x != null)
    if (nums.length >= 2 && nums[1] > nums[0]) {
      return {
        calls: [{ name: 'set_loop_region', input: { start: { bar: nums[0] }, end: { bar: nums[1] } } }],
        confidence: 0.9, matched: 'set_loop_region', needsName: false,
      }
    }
    if (has(w, 'on', 'enable')) {
      return {
        calls: [{ name: 'set_loop_region', input: { enabled: true } }],
        confidence: 0.92, matched: 'set_loop_enabled', needsName: false,
      }
    }
  }

  // ── Transport ────────────────────────────────────────────────────────────
  // "from the top" and "start over" both mean restart, and so does "restart"
  // buried in a longer sentence — which is what was failing: the read-back said
  // it had restarted while an anchored pattern had never matched at all.
  const fromTheTop = has(w, 'restart', 'beginning', 'top')
    || (has(w, 'start', 'go', 'back') && has(w, 'over', 'top', 'beginning', 'start'))
  if (fromTheTop) {
    return {
      calls: [{ name: 'transport', input: { action: 'restart' } }],
      confidence: 0.93, matched: 'transport.restart', needsName: false,
    }
  }
  if (has(w, 'bar', 'measure') && n != null && n > 0) {
    return {
      calls: [{ name: 'transport', input: { action: 'locate', at: { bar: n } } }],
      confidence: 0.9, matched: 'transport.locate', needsName: false,
    }
  }
  if (has(w, 'stop', 'halt')) {
    return {
      calls: [{ name: 'transport', input: { action: 'stop' } }],
      confidence: 0.95, matched: 'transport.stop', needsName: false,
    }
  }
  if (has(w, 'pause')) {
    return {
      calls: [{ name: 'transport', input: { action: 'pause' } }],
      confidence: 0.95, matched: 'transport.pause', needsName: false,
    }
  }
  // Last, and only when the sentence is ENTIRELY about the transport.
  //
  // "play" turns up inside sentences that are not the transport at all, and a
  // loose word count is not enough of a guard: "play the bass louder" is three
  // content words after filler and was matching as a bare play — caught by the
  // test that exists for exactly this. Every remaining word has to be part of
  // saying "play", otherwise the sentence is about something else and belongs
  // to the assistant.
  const TRANSPORT_ONLY = new Set(['play', 'start', 'go', 'playing', 'playback', 'begin', 'resume'])
  if (has(w, 'play', 'start', 'go') && w.every(x => TRANSPORT_ONLY.has(x))) {
    return {
      calls: [{ name: 'transport', input: { action: 'play' } }],
      confidence: 0.94, matched: 'transport.play', needsName: false,
    }
  }

  return NOTHING
}
