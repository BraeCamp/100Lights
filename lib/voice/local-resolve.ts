'use client'
// ── Understanding a command without asking anyone ───────────────────────────
//
// Brae: "Connect AI for now ... whenever something is said and the program has
// low confidence in hearing it or in its answer then we can put AI on it ... it
// would run the answer through the voice program's wiring so that it's already
// wired for switching the answer to the program instead of AI."
//
// That is the shape this file exists to serve, and it is the right shape. The
// swap point is already there: everything downstream consumes `VoiceCall[]`
// — `{ name, input }` — and planVoiceCalls has no idea whether a call came from
// a model or from a regular expression. So AI is not the feature; it is the
// CURRENT IMPLEMENTATION of one step, and every command it resolves is a worked
// example of what this file should learn to do itself.
//
// What belongs here is the traffic: "play", "stop", "mute the pad", "set the
// tempo to 128", "loop bars 9 to 17". Short, unambiguous, said constantly, and
// costing a network round trip and a credit every single time. What does NOT
// belong here is anything needing judgement — "make the chorus feel bigger" —
// which is exactly what a model is for.
//
// Confidence is the whole interface. This never guesses: it returns a call with
// a number attached, and the caller decides whether that number is good enough.
// A wrong local answer is worse than a slow correct one, because it is silent
// and free and therefore happens a lot.

import type { VoiceCall } from './execute-music'
import { findByName, spokenNumber } from './resolve'

export interface LocalResult {
  calls: VoiceCall[]
  /** 0–1. Anything the caller does not fully trust should go to the assistant. */
  confidence: number
  /** Which rule fired, for the log and for knowing what to promote next. */
  matched: string
  /**
   * Did this depend on resolving a spoken TRACK NAME?
   *
   * The distinction decides how much the transcriber's own confidence matters.
   * A rule that matched the whole utterance against a fixed vocabulary carries
   * its own proof; one that had to find "the pad" among the project's tracks
   * is only as good as the words it was given.
   */
  needsName: boolean
}

const NOTHING: LocalResult = { calls: [], confidence: 0, matched: 'none', needsName: false }

/** Lower-case, collapse whitespace, drop trailing punctuation. */
const norm = (s: string): string =>
  s.toLowerCase().replace(/[.,!?;]+$/g, '').replace(/\s+/g, ' ').trim()

/** A number written as digits or spoken as a word. */
function num(s: string | undefined): number | null {
  if (!s) return null
  const direct = Number(s)
  if (Number.isFinite(direct)) return direct
  return spokenNumber(s)
}

export interface ResolveContext {
  tracks: { id: string; name?: string }[]
}

/**
 * Try to turn a sentence into commands locally.
 *
 * Rules are ordered most-specific first, and each one either matches
 * completely or declines — a partial match returns nothing rather than a guess,
 * because half-understanding a command is how the wrong track gets muted.
 */
export function resolveLocally(sentence: string, ctx: ResolveContext): LocalResult {
  const t = norm(sentence)
  if (!t) return NOTHING

  // ── Transport ─────────────────────────────────────────────────────────────
  // The most-said commands in the studio, and the least ambiguous. Anchored to
  // the whole utterance: "play" is transport, "play the bass louder" is not.
  if (/^(play|start|go)$/.test(t) || /^(start|hit) (playing|playback)$/.test(t)) {
    return { calls: [{ name: 'transport', input: { action: 'play' } }], confidence: 0.97, matched: 'transport.play', needsName: false }
  }
  if (/^(stop|pause|halt)( it| playing| playback)?$/.test(t)) {
    return {
      calls: [{ name: 'transport', input: { action: t.startsWith('pause') ? 'pause' : 'stop' } }],
      confidence: 0.97, matched: 'transport.stop', needsName: false,
    }
  }
  if (/^(restart|start over|from the top|back to the (start|beginning))$/.test(t)) {
    return { calls: [{ name: 'transport', input: { action: 'restart' } }], confidence: 0.95, matched: 'transport.restart', needsName: false }
  }

  // "go to bar 9" — a locate, with the bar spelled out or spoken.
  {
    const m = t.match(/^(?:go to|jump to|move to) bar (\w+)$/)
    const bar = m && num(m[1])
    if (bar && bar > 0) {
      return {
        calls: [{ name: 'transport', input: { action: 'locate', at: { bar } } }],
        confidence: 0.9, matched: 'transport.locate', needsName: false,
      }
    }
  }

  // ── Tempo ─────────────────────────────────────────────────────────────────
  // Only the whole-song form. "128 at bar 17" is a tempo MARKER, which is a
  // different edit and rarer, so it goes to the assistant.
  {
    const m = t.match(/^(?:set (?:the )?tempo to|tempo|make it|take it to|go to) (\w+)(?: bpm)?$/)
      || t.match(/^(\w+) bpm$/)
    const bpm = m && num(m[1])
    // A plausible musical tempo. 3 or 900 is a misheard word, not a request.
    if (bpm && bpm >= 20 && bpm <= 300) {
      return { calls: [{ name: 'set_tempo', input: { bpm } }], confidence: 0.92, matched: 'set_tempo', needsName: false }
    }
  }

  // ── Loop ──────────────────────────────────────────────────────────────────
  {
    const m = t.match(/^loop (?:bars? )?(\w+) (?:to|through|until) (?:bar )?(\w+)$/)
    const a = m && num(m[1]), b = m && num(m[2])
    if (a && b && b > a) {
      return {
        calls: [{ name: 'set_loop_region', input: { start: { bar: a }, end: { bar: b } } }],
        confidence: 0.9, matched: 'set_loop_region', needsName: false,
      }
    }
  }
  if (/^(turn )?loop(ing)? (on|off)$/.test(t)) {
    return {
      calls: [{ name: 'set_loop_region', input: { enabled: /on$/.test(t) } }],
      confidence: 0.94, matched: 'set_loop_enabled', needsName: false,
    }
  }

  // ── Mixer ─────────────────────────────────────────────────────────────────
  // The target has to resolve to EXACTLY one track by name, and the match has
  // to be a strong one. "mute the bass" with two bass tracks scores low and
  // goes to the assistant, which can ask which — that question is the correct
  // outcome, not a failure.
  {
    const m = t.match(/^(mute|unmute|solo|unsolo|un-solo) (?:the )?(.+)$/)
    if (m) {
      const verb = m[1]
      const hit = findByName(m[2], ctx.tracks)
      if (hit && hit.score >= 0.75) {
        const input: Record<string, unknown> = { target: { name: hit.item.name } }
        if (verb === 'mute') input.muted = true
        else if (verb === 'unmute') input.muted = false
        else if (verb === 'solo') input.solo = true
        else input.solo = false
        return {
          calls: [{ name: 'set_track', input }],
          // The rule is certain; the NAME is what carries the risk, so the
          // match's own score is folded in rather than asserted over.
          confidence: Math.min(0.93, 0.6 + hit.score * 0.35),
          matched: `set_track.${verb}`,
          needsName: true,
        }
      }
    }
  }

  // "set the bass to 80 percent" — an absolute level only. "a bit louder" is
  // deliberately absent: how much "a bit" is has not been decided, and picking
  // a number here would quietly make that decision.
  {
    const m = t.match(/^(?:set|put) (?:the )?(.+?) (?:volume )?to (\w+)(?: percent| %)?$/)
    const v = m && num(m[2])
    if (m && v !== null && v >= 0 && v <= 100) {
      const hit = findByName(m[1], ctx.tracks)
      if (hit && hit.score >= 0.75) {
        return {
          calls: [{ name: 'set_track', input: { target: { name: hit.item.name }, volume: v } }],
          confidence: Math.min(0.9, 0.55 + hit.score * 0.35),
          matched: 'set_track.volume',
          needsName: true,
        }
      }
    }
  }

  return NOTHING
}

/**
 * Is this good enough to run without asking the assistant?
 *
 * Both signals have to hold: the words have to have been HEARD well, and the
 * sentence has to have been UNDERSTOOD well. Either one being shaky is reason
 * to spend the round trip — a wrong edit costs far more than a slow one.
 */
export function confidentEnough(local: LocalResult, heardConfidence: number): boolean {
  if (!local.calls.length || local.confidence < 0.85) return false

  // ── How sure the transcriber needs to be depends on what matched ──────────
  //
  // Brae, after saying "start" and being told the AI was out of credits: "it
  // should be a non-AI response — it should have high confidence after running
  // through the existing program that it already knows the command."
  //
  // He is right, and the first version got this wrong by treating both signals
  // as one flat AND. A transcriber reports LOW confidence on short utterances
  // as a matter of course — "start" is one syllable with no context to check
  // itself against, and Deepgram routinely rates it below 0.75 — so a single
  // hard threshold sent the simplest, most-used commands in the studio to a
  // model, which is the exact opposite of the intent.
  //
  // The insight is that an exact match against a FIXED vocabulary carries its
  // own proof. "start" is not a word the resolver half-recognised; it is the
  // whole utterance, matched completely, against a list of a dozen commands.
  // For a mishearing to produce it, the speaker would have had to say something
  // that lands exactly on another known command — and the cost of that is a
  // transport button pressed, which is instantly obvious and instantly undone.
  //
  // A NAME is the opposite case. "mute the pad" is only as good as the word
  // "pad", the project has a dozen candidates, and muting the wrong track is
  // quiet and easy to miss. That one still wants the transcriber to be sure.
  const needed = local.needsName ? 0.6 : 0.3
  return heardConfidence >= needed
}
