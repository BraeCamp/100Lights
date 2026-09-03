'use client'
// ============================================================================
//  Talking to Beacon.
//
//  Brae: "we're gonna have a voice control button that allows users to tell the
//  program what to do ... There will be a setting to press enter to execute
//  voice commands, toggled or hold to speak."
//
//  The whole path: hold (or toggle) the button, say the sentence, and the words
//  go to the assistant with a summary of the song. It answers with tool calls,
//  those are turned into real DAW actions by lib/voice/execute-music, and the
//  button reads back what it did in the user's own terms.
//
//  Two things it will not do:
//
//  It never runs free text. Only the named tools in lib/voice/music-tools can
//  become an edit, and the executor refuses any name it does not know — so a
//  misheard sentence produces "I don't know how to do that yet", not an edit
//  nobody asked for.
//
//  It never edits silently. Every command reads back the sentence it performed
//  ("Looped the first clip on Bass 2 3 more times"), because the one thing
//  worse than mishearing is mishearing invisibly. Undo covers the rest.
// ============================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Mic, Loader2, Settings2 } from 'lucide-react'
import { reducer as dawReducer, makeMidiClip, makeAudioClip, extractPeaks, type DawAction } from '@/lib/daw-state'
import { useLight } from '@/lib/voice/use-light'
import { useRouter } from 'next/navigation'
import { isSpeechAvailable, listen, requestMic, stripWakeWord, type SpeechHandle } from '@/lib/voice/speech'
import { musicStateSummary } from '@/lib/voice/music-tools'
import { drumTake, chordTake, takeToNotes, describeTake } from '@/lib/voice/pass'
import { detectOnsets, monoOf } from '@/lib/voice/onsets'
import { combinePresets } from '@/lib/midi-presets'
import { hearBetter } from '@/lib/voice/hear-better'
import { resolveLocally, resolveHeard, confidentEnough, runsLocally, needsNoProject } from '@/lib/voice/local-resolve'
import type { Heard } from '@/lib/voice/hypotheses'
import { COMMAND_VOCABULARY, commandHelp } from '@/lib/voice/interpret'
import { remember, markFailed, recentContext } from '@/lib/voice/voice-memory'
import { traceStart, traceTurn, traceEnd } from '@/lib/voice/voice-trace'
import {
  startRecording, preferredTranscriber, setPreferredTranscriber, micProblemMessage,
  type Recording, type StopResult, type MicReport,
} from '@/lib/voice/record'
import { planVoiceCalls, planVoiceCallsEach, type VoiceCall } from '@/lib/voice/execute-music'
import { recallCommand, rememberCommand, forgetKey, mergeShared, shareableTemplate } from '@/lib/voice/learned'
import { recordCommand } from '@/lib/voice/voice-ledger'
import { macroNames } from '@/lib/voice/macros'
import {
  auditionActive, readBrowseCommand, startAudition, stopAudition, audition,
  buildQueue, beatItems, currentItem, onAudition, auditionState, recipeTags, matchesWant,
  presetFromLibrary, type BrowseAction, type AuditionItem,
} from '@/lib/voice/audition'
import { readChoice, readYesNo, type VoiceAsk, type AskOffer } from '@/lib/voice/ask'
import { noticeFor } from '@/lib/voice/notices'
import { WAKE_WORDS, shouldActOn, worthTheModel } from '@/lib/voice/attention'
import { stitch, worthHolding, looksIncomplete, continuesPrevious, notAlreadyRun, STITCH_MS, CONTINUE_MS } from '@/lib/voice/stitch'
import { useDropDirection, useMountTransition, popClass } from '@/lib/ui/popup'
import { interpretSequence } from '@/lib/voice/sequence'
import { interpret } from '@/lib/voice/interpret'
import {
  readQueueControl, askToImplement, readBack, reportRun, type QueuedCommand,
} from '@/lib/voice/queue'
import { hudOn, setHud, applyHud } from '@/lib/voice/hud'
import {
  CALIBRATION_PHRASE, phraseAccuracy, verdictFor, type CalibrationResult,
} from '@/lib/voice/calibrate'
import VoicePanel, { type VoiceSide } from './VoicePanel'
import VoiceHud from './VoiceHud'
import VoiceCaption, { readVoiceCaption, writeVoiceCaption } from './VoiceCaption'
import { recordExchange, describeAction } from '@/lib/voice/transcript'
import { LUMENS_NAME } from '@/lib/credit-tiers'
import {
  speak, stopSpeaking, speechEnabled, setSpeechEnabled, speechAvailable,
  studioVoice, setStudioVoice,
  voiceSensitivity, setVoiceSensitivity, voicePatience, setVoicePatience, aiActs,
  assistantMode, setAssistantMode, type AssistantMode,
} from '@/lib/voice/speak'

const C = {
  bgSurface: '#1c1c1c',
  border: 'var(--border)',
  accent: 'var(--accent)',
  textPrimary: '#e8e8e8',
  textMuted: '#7c7c7c',
} as const

/**
 * How long the microphone stays deaf AFTER the studio stops speaking.
 *
 * Long enough to cover the output buffer and a small room's decay, short enough
 * that answering straight back still works. Somebody who talks over the
 * read-back is already covered — the mute is lifted the moment this elapses,
 * not when they stop.
 */
const ECHO_TAIL_MS = 350

export type VoiceMode = 'hold' | 'toggle'
const MODE_KEY = 'beacon.voice.mode'
const ENTER_KEY = 'beacon.voice.enter'

export function readVoiceMode(): VoiceMode {
  try { return localStorage.getItem(MODE_KEY) === 'toggle' ? 'toggle' : 'hold' } catch { return 'hold' }
}
export function readVoiceEnter(): boolean {
  try { return localStorage.getItem(ENTER_KEY) !== 'off' } catch { return true }
}
function writeVoiceMode(m: VoiceMode) { try { localStorage.setItem(MODE_KEY, m) } catch { /* private mode */ } }
function writeVoiceEnter(on: boolean) { try { localStorage.setItem(ENTER_KEY, on ? 'on' : 'off') } catch { /* private mode */ } }

/** What it says when an answer is taking a moment. Rotated rather than random
 *  so the same command twice does not feel like two different studios. */
const WORKING = ['Working on it.', 'Give me a moment.', 'Of course — one moment.']

// ── The commands every other studio has been taught ────────────────────────
//
// Fetched once a day, and never in a way that can hold up a command: the pool
// is an improvement on top of a studio that already works, so a slow or missing
// answer here has to cost nothing at all. Module-level, so several Light mounts
// in one session share the single fetch.
const POOL_STAMP = 'light.learned.shared.at'
let poolPulled = false
function pullSharedCommands() {
  if (poolPulled) return
  poolPulled = true
  try {
    const at = Number(localStorage.getItem(POOL_STAMP) ?? 0)
    if (Date.now() - at < 12 * 60 * 60 * 1000) return
  } catch { /* private mode: pull anyway */ }
  void fetch('/api/voice/learned')
    .then(r => r.ok ? r.json() : null)
    .then((data: { entries?: { template: string; calls: { name: string; input: Record<string, unknown> }[] }[] } | null) => {
      if (!data?.entries?.length) return
      mergeShared(data.entries)
      try { localStorage.setItem(POOL_STAMP, String(Date.now())) } catch { /* nothing to keep it in */ }
    })
    .catch(() => { /* the studio works without it */ })
}

export default function VoiceControl({ style }: { style?: React.CSSProperties }) {
  const {
    inStudio,
    project, dispatch, engine, undo, redo, beginUndoGroup, endUndoGroup, selectedTrackId, selectedClipId,
    metronome, setMetronome, setExpandedStepSeqClipId, setExpandedPianoRollClipId,
    setSelectedClipIds, setSelectedClipId, setSelectedTrackId,
    setShowPads, setApolloRack, setShowAppearance,
  } = useLight()
  const router = useRouter()
  const [listening, setListening] = useState(false)
  const [busy, setBusy] = useState(false)
  /** `busy` for the callbacks — a take that lands mid-command reads the ref,
   *  not the value captured when its listener was built. */
  const busyRef = useRef(false)
  /** Guards the "working on it" line against the answer that beat it. */
  const ackToken = useRef(0)
  /**
   * The sentence being acted on — and its QUESTION, when there was one.
   *
   * ⚠️ Brae: "When I was speaking to it, it moved me to bar 100... It asked
   * which track and I told it before it did this."
   *
   * That is why speaking failed where typing worked. A command spread over two
   * turns puts the INTENT in the first sentence and the answer in the second,
   * so by the time the model emitted the move, the sentence notAMove was
   * judging was just "the pad" — no edit words in it, nothing to refuse. Typed
   * in one go, the same request was caught.
   *
   * So an answer to a question continues the exchange rather than replacing it.
   */
  const saidRef = useRef<string[]>([])
  /**
   * The last command that RAN — its words and its calls — so a take that picks
   * up where it left off ("…and the hats") can be read as the whole sentence and
   * only the unfinished part carried out. See continuesPrevious / notAlreadyRun.
   */
  const lastRunRef = useRef<{ text: string; calls: VoiceCall[]; at: number } | null>(null)
  useEffect(pullSharedCommands, [])
  // ⚠️ Warm the assistant's function while nobody is speaking yet. A serverless
  // route that has sat idle is reloaded on its next request, and that reload
  // used to land on the first command after a pause — most of them. A 204 GET
  // now, and the function is resident by the time anybody has said a word.
  useEffect(() => { void fetch('/api/ai/assist', { method: 'GET' }).catch(() => {}) }, [])
  useEffect(() => { busyRef.current = busy }, [busy])
  const [heard, setHeard] = useState('')
  const [said, setSaid] = useState('')
  const [problem, setProblem] = useState('')
  /** Is the studio speaking right now? Drives the card's waveform. */
  const [talking, setTalking] = useState(false)
  const [mode, setMode] = useState<VoiceMode>('hold')
  const [enterRuns, setEnterRuns] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  // ── Typing is a first-class way in, not a consolation prize ───────────────
  //
  // Chrome's speech recognition is not local: it streams audio to Google and
  // gets words back, so it can be unavailable for reasons that have nothing to
  // do with this app — a VPN, a firewall, a region, a service hiccup, or a
  // browser that never had it. Firefox has none at all.
  //
  // Everything downstream of the words is text: musicStateSummary, the
  // assistant, planVoiceCalls, the reducer actions. The microphone was only
  // ever a way to produce a sentence, so a text box is the SAME feature with
  // one less dependency — and it is the difference between "voice control does
  // not work here" and "voice control is one keystroke slower here".
  // ── A conversation, not a series of one-shot commands ────────────────────
  //
  // Every request used to be sent as `messages: [{ role: 'user', ... }]` — one
  // message, no history — so the assistant could ASK "which bass track?" and
  // never hear the answer: the reply arrived as a fresh conversation with no
  // memory of the question. /api/ai/assist has always accepted up to 40
  // messages with user/assistant roles; the client simply never sent them.
  //
  // Kept short on purpose. This is a command line, not a chat log: enough turns
  // to finish a clarification, few enough that an old misunderstanding cannot
  // steer a new command. Cleared when a command completes, because at that
  // point the exchange is closed.
  const history = useRef<{ role: 'user' | 'assistant'; content: string }[]>([])

  // The song as it is NOW, for the assistant loop.
  //
  // ⚠️ `project` inside the callback is the value captured when the callback
  // was built. After the loop dispatches an edit, reading it again returns the
  // song from BEFORE that edit — so the assistant would check its work against
  // a project that never had the change in it, and be told its own edit had not
  // happened. Refs are the state as of the last commit, which is what a turn
  // after a dispatch needs. This file has produced the stale-closure bug three
  // times already; this is the same shape.
  // Is a question on screen right now? Read inside run(), which does not list
  // `asking` as a dependency — the value it would otherwise close over is the
  // one from when the callback was built, which is the stale-closure bug this
  // file has produced several times.
  const askingRef = useRef('')
  // A sentence the studio could make nothing of, kept in case the next one is
  // the rest of it. See lib/voice/stitch.ts.
  const heldFragment = useRef<{ text: string; at: number } | null>(null)
  /** The assistant refused for billing. See the branch that reads it. */
  const outOfLumens = useRef(false)


  const projectRef = useRef(project)
  const selectedTrackIdRef = useRef(selectedTrackId)
  const selectedClipIdRef = useRef(selectedClipId)
  useEffect(() => { projectRef.current = project }, [project])
  useEffect(() => { selectedTrackIdRef.current = selectedTrackId }, [selectedTrackId])
  useEffect(() => { selectedClipIdRef.current = selectedClipId }, [selectedClipId])
  /** The assistant asked something and is waiting — a question, not a failure. */
  const [asking, setAsking] = useState('')
  useEffect(() => { askingRef.current = asking }, [asking])
  // ⚠️ A question and a failure must never be on screen together. Brae: "It
  // said 'I didn't get that' in the window but it asked an applicable question
  // under the Voice button." They are two different surfaces — the question is
  // a popover by the Voice button, the problem is a line in the card — so
  // nothing stopped them contradicting each other, and the one that reads like
  // the answer ("it failed") is the wrong one.
  //
  // Here rather than at each call site: a question can be raised from the
  // assistant loop, the local resolver or a queued confirmation, and a rule
  // that has to be remembered in three places is a rule that gets forgotten in
  // one of them.
  useEffect(() => { if (asking) setProblem('') }, [asking])
  const [typed, setTyped] = useState('')
  const [showType, setShowType] = useState(false)
  /** 0–1 microphone loudness while recording, for the meter on the button. */
  const [level, setLevel] = useState(0)
  /**
   * When a command was last accepted.
   *
   * Brae: "I don't want background noise to mess with the on toggled voice
   * command system."
   *
   * This is the whole attention model. Inside the window the studio is in a
   * conversation and takes what it hears; outside it, it is on but quiet and
   * needs its name first. Clicking the button counts as being spoken to,
   * because it is.
   */
  const lastAcceptedAt = useRef(0)

  const [panelOpen, setPanelOpen] = useState(false)
  // ⚠️ Which way these open is a fact about where the button IS, not a constant.
  // Brae: "On most pages, the voice and type controls are on the bottom right of
  // the screen so their menus go down and off of the viewport." In the transport
  // bar there is a whole editor below; docked in the corner there is nothing.
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const panelDir = useDropDirection(panelOpen, 544, anchorRef)
  const typeDir = useDropDirection(showType, 220, anchorRef)
  const panelAnim = useMountTransition(panelOpen)
  const typeAnim = useMountTransition(showType)

  /**
   * A choice you are being asked to make, sized like one.
   *
   * Brae: "make the options bigger when there are multiple and connect them to
   * the voice control window when it is open."
   *
   * These were 11px rows in a 340px popover — the same weight as a tooltip, for
   * the one moment the studio has stopped and is waiting on you. A question
   * that has to be answered is the most important thing on screen while it is
   * there, and it was the smallest.
   */
  const choiceStyle = (accent: boolean): React.CSSProperties => ({
    textAlign: 'left', padding: '11px 13px', borderRadius: 7, cursor: 'pointer',
    border: `1px solid ${accent ? C.accent : C.border}`,
    background: accent ? 'rgb(var(--accent-rgb) / .12)' : '#171717',
    color: C.textPrimary, fontSize: 13.5, lineHeight: 1.35, fontWeight: 500,
    transition: 'background .12s, border-color .12s',
  })
  const choiceHover = (e: React.MouseEvent<HTMLButtonElement>, on: boolean) => {
    e.currentTarget.style.background = on ? 'rgb(var(--accent-rgb) / .22)' : '#171717'
    e.currentTarget.style.borderColor = on ? C.accent : C.border
  }

  // (askAnchor lived here: it decided which corner a floating question got,
  // anchoring to the panel when open and the button when not. Questions live
  // inside the window now, so there is no corner left to choose.)

  /** What is open in the bar beside the voice card — see VoiceSide. */
  const [side, setSide] = useState<VoiceSide>('none')
  /** The meter's last painted value and when — see onLevel. */
  const levelPaintedAt = useRef(0)
  const levelPainted = useRef(0)
  /** One object for the card's colours, not a new literal per render — the
   *  bar beside the card memoises on it. */
  const panelColors = useMemo(() => ({
    bgSurface: C.bgSurface, border: C.border, textPrimary: C.textPrimary,
    textMuted: C.textMuted, accent: C.accent,
  }), [C.bgSurface, C.border, C.textPrimary, C.textMuted, C.accent])
  /** The library of everything Light can do — its own window, not a view in
   *  the card. See VoiceLibrary.tsx for why. */
  /** Big on-screen captions of what was said — a recording aid, off by
   *  default. See VoiceCaption.tsx for why it is not a feature. */
  const [caption, setCaption] = useState(false)
  /** The sentence AS SPOKEN, for the caption.
   *
   *  ⚠️ Not `heard`, which is the name-repaired version: "make the pad
   *  brighter" becomes "make Pad brighter" once hearBetter has matched the
   *  track name. That is the right thing for the studio to act on and the
   *  wrong thing to put under somebody's face in a video — a subtitle that
   *  does not match what was said reads as a transcription error, in a demo
   *  whose whole point is that it heard correctly. */
  const [spokenRaw, setSpokenRaw] = useState('')
  const [hud, setHudState] = useState(false)
  /** What the microphone turned out to be, for the panel and for diagnosing a
   *  device that cannot record and monitor at the same time. */
  const [mic, setMic] = useState<MicReport | null>(null)

  /**
   * Commands said but not yet carried out.
   *
   * Brae: "Can we have it collect executable commands... and it executes when I
   * say 'Execute' or 'Go ahead'."
   *
   * Every command until now happened the instant it was understood, which is
   * right for "stop" and wrong for working through an idea. Collected, they can
   * be heard back and corrected before anything has been done rather than
   * after.
   */
  const [queue, setQueue] = useState<QueuedCommand[]>([])
  const [collecting, setCollecting] = useState(false)
  /** Always the current runQueue(), because run() is defined above it. */
  const runQueueRef = useRef<(() => void) | null>(null)
  const collectingRef = useRef(false)
  /** So the offer to implement is made once per batch, not on every tick. */
  const offeredAt = useRef(0)
  const lastQueuedAt = useRef(0)
  /** The bar the level is being judged against, drawn on the meter. */
  const [threshold, setThreshold] = useState(0)
  const [sensitivity, setSensitivityState] = useState(1)
  /** The last microphone check, and whether one is running. */
  const [calibration, setCalibration] = useState<CalibrationResult | null>(null)
  const [calibrating, setCalibrating] = useState<null | 'room' | 'voice'>(null)
  const [aiAuto, setAiAutoState] = useState(false)
  const aiAutoRef = useRef(false)
  // How much the assistant may do, and which ear is listening. Both are read
  // from storage on mount with everything else — never during render, because
  // localStorage does not exist on the server and a first paint that disagrees
  // with the second is a hydration mismatch.
  const [assist, setAssistState] = useState<AssistantMode>('ask')
  const assistRef = useRef<AssistantMode>('ask')
  const [ear, setEarState] = useState<'browser' | 'server'>('browser')
  /** What the last assistant turn cost, and what is left. Shown while testing,
   *  because a balance nobody can see is a balance nobody notices draining. */
  const [credits, setCredits] = useState<{ spent: number; left: number } | null>(null)
  // Read by the recorder's callbacks, which outlive the render that made them.
  const sensitivityRef = useRef(1)
  /** How long a pause counts as "finished" — see voicePatience(). */
  const patienceRef = useRef(voicePatience())
  const [patience, setPatienceState] = useState(patienceRef.current)
  /**
   * Until when the PERSON is talking, as far as the microphone can tell — set
   * forward by every level reading above the bar and every interim transcript.
   * Brae: "we also need for it to wait to answer verbally if talking is still
   * happening." Light reads the reply on screen at once and speaks it only
   * once this has passed.
   */
  const userSpeakingUntil = useRef(0)
  const deferToken = useRef(0)
  /**
   * True once the assistant has refused this session (signed out, out of
   * Lumens). The sentence is then read the way the rules-only mode reads it —
   * including a compound sentence split into its parts — instead of being
   * handed to a model that will not answer.
   */
  const assistantDownRef = useRef(false)
  /** The last thing Light said out loud, so hearing it back is not a command. */
  const lastSpokenRef = useRef('')

  /**
   * Whether the studio is currently taking commands, for the person looking at
   * it.
   *
   * A microphone indicator that cannot distinguish "hearing you" from "waiting
   * to be spoken to" is the thing people complain about in every always-on
   * assistant ever shipped — you cannot tell whether it ignored you or is about
   * to act. Polled rather than scheduled, because the window is restarted by
   * every accepted command and a timer would have to be cancelled and rebuilt
   * on each one.
   */

  /** The mode as it is NOW. The recorder's callbacks outlive the render that
   *  created them, and a stale mode would decide whether to keep listening. */
  const modeRef = useRef<VoiceMode>('hold')
  const continuousRef = useRef(false)

  /** Always the current finish(), so a take that ends itself uses the live one. */
  const finishRef = useRef<(() => void) | null>(null)
  // ── Nothing is spent without being asked ─────────────────────────────────
  //
  // Brae: "I'm worried that AI will mishear things and create commands and use
  // credits accidentally. Can we set a barrier so that it doesn't use credits
  // before confirming?" And then: "every single time it should get confirmation
  // first."
  //
  // So a command the local rules cannot answer stops here instead of going to
  // the assistant. What was HEARD is shown — and is editable — because the
  // worry is a mishearing, and the only way to catch one is to read it before
  // it is acted on. Correcting the text re-runs the local rules first, so a
  // fixed sentence usually costs nothing at all.
  //
  // The local path is deliberately not gated: it spends nothing, so asking
  // permission for it would be a toll booth on a free road.
  const [pendingAsk, setPendingAsk] = useState<string | null>(null)
  // ── When two readings are equally good ───────────────────────────────────
  //
  // Ambiguity is not the same failure as not understanding, and answering it
  // the same way is wrong twice over: it offers to spend credits on a sentence
  // that was already understood, and it hides that the studio had two perfectly
  // good readings of it.
  //
  // So an ambiguous command asks WHICH, listing what each would do in the same
  // words used to report a command that ran. Choosing costs nothing — the
  // readings are already in hand.
  const [choices, setChoices] = useState<{ label: string; calls: VoiceCall[] }[] | null>(null)
  // ── About to destroy something ───────────────────────────────────────────
  //
  // Deleting a track is the one command where being wrong is not recoverable by
  // saying the opposite, and a voice command is exactly the kind of input that
  // arrives misheard. So it is read back and confirmed — the same shape as the
  // credit barrier, for the same reason: the cost of asking is a keystroke, and
  // the cost of not asking is somebody's work.
  const [pendingDo, setPendingDo] = useState<{ label: string; calls: VoiceCall[] } | null>(null)

  // ── The conversation ─────────────────────────────────────────────────────
  //
  // Brae: "The program would ask 'Do you mean the bass track, or the bass item
  // on the bass track at bar 15?'... 'Would you like to rename the bass item at
  // bar 15 to avoid confusion?' and 'What would you like to change it to?'"
  //
  // Three states, because that exchange has three steps: a question with
  // options, an offer to fix the cause, and a prompt for the new name. Whatever
  // is pending gets the NEXT utterance before the parser does — someone
  // answering "the track" is not issuing a command, and interpreting it as one
  // is how a conversation turns into a series of non-sequiturs.
  const [pendingAsk2, setPendingAsk2] = useState<VoiceAsk | null>(null)
  const [pendingOffer, setPendingOffer] = useState<AskOffer | null>(null)
  const [pendingName, setPendingName] = useState<AskOffer | null>(null)
  const [speaks, setSpeaks] = useState(false)
  // Which voice does the answering. Read from storage on mount alongside the
  // rest, never during render — localStorage is not there on the server, and a
  // first paint that disagrees with the second is a hydration mismatch.
  const [studio, setStudio] = useState(true)

  /**
   * Say something, and show it.
   *
   * Speech is never the delivery — the text always appears. A browser with no
   * voices, a muted machine, or somebody who turned speech off must still see
   * every answer, so this sets the visible state first and speaks second.
   */
  const respond = useCallback((
    text: string,
    kind: 'report' | 'question' | 'problem' = 'report',
    retry = 0,
  ) => {
    // ── Not over the top of you ─────────────────────────────────────────────
    //
    // Brae: "it starts talking over me at some point… we also need for it to
    // wait to answer verbally if talking is still happening."
    //
    // ⚠️ THE WORDS GO ON SCREEN NOW; THE VOICE WAITS. A reply that arrives
    // while you are still mid-sentence is read back the moment you stop —
    // checked every 150 ms, for up to six seconds, after which it speaks
    // anyway rather than never. A newer reply supersedes a waiting one.
    deferToken.current += 1
    if (Date.now() < userSpeakingUntil.current && retry < 40) {
      if (kind === 'problem') setProblem(text)
      else { setSaid(text); setProblem('') }
      const mine = deferToken.current
      window.setTimeout(() => { if (deferToken.current === mine) respond(text, kind, retry + 1) }, 150)
      return
    }
    if (kind === 'problem') setProblem(text)
    else {
      setSaid(text)
      // ⚠️ Brae: "it sometimes says 'I didn't catch that' then does what I
      // wanted, which means that it did catch it."
      //
      // It did. A failure and a success could sit on screen together, because
      // answering only ever wrote to `said` and never cleared `problem` — so a
      // stale "didn't catch that", usually from a take of room noise while the
      // real command was still with the assistant, stayed put underneath the
      // answer. Two states at once, and the wrong one read first.
      setProblem('')
    }
    // When the studio last spoke. Anything pointed at AFTER this is newer than
    // the conversation, which is what lets a click outrank a sentence.
    lastReplyAt.current = Date.now()
    lastSpokenRef.current = text
    // isPlaying is a PROPERTY, not a method. Calling it threw, which left the
    // control stuck busy and silently blocked every command after the first —
    // a one-character mistake that looked like the whole feature had broken.
    //
    // With the microphone held open across commands it is still listening when
    // there is something to say, so staying silent would mean never speaking at
    // all in the mode where speaking is most useful. It is deafened for the
    // duration instead — audio captured while the studio talks is discarded, so
    // it cannot transcribe its own read-back and act on it.
    // Whether the studio is talking, for the card's waveform. Set around the
    // utterance rather than inferred from `said`, because the text appears
    // whether or not it is spoken aloud — and the wave is about the voice.
    const held = recorder.current
    if (held) {
      held.setMuted(true)
      setTalking(true)
      // ⚠️ AND A MOMENT AFTERWARDS. Brae: "add something that makes it so that
      // the program doesn't hear its own responses."
      //
      // Muting for the utterance was already here and is not enough. `onended`
      // fires when the audio ELEMENT finishes, which is before the sound has
      // finished leaving the speaker and well before it has finished bouncing
      // off the room — so unmuting on that edge hands the recogniser the tail
      // of the studio's own voice, which is exactly the part that sounds like
      // somebody muttering a command.
      //
      // The token is what makes this safe: if another answer begins during the
      // wait, its own mute wins and this one must not undo it.
      unmuteToken.current += 1
      const mine = unmuteToken.current
      speak(text, {
        kind,
        playing: !!engine?.isPlaying,
        onDone: () => {
          setTalking(false)
          window.setTimeout(() => {
            if (unmuteToken.current === mine) held.setMuted(false)
          }, ECHO_TAIL_MS)
        },
      })
    } else {
      setTalking(true)
      speak(text, {
        kind,
        playing: !!engine?.isPlaying,
        listening,
        onDone: () => setTalking(false),
      })
    }
  }, [engine, listening])
  /** Guards the unmute against an answer that starts while the last one settles. */
  const unmuteToken = useRef(0)
  /**
   * The bake's progress, refreshed on a slow tick.
   *
   * ⚠️ Polled rather than read at question time: combineStats() walks every
   * cached buffer to compute peaks, which is far too much work to do inside a
   * sentence — and this only needs to be roughly right.
   */
  const loadingRef = useRef<{ done: number; total: number; error?: string | null } | null>(null)
  useEffect(() => {
    if (!inStudio) return
    let alive = true
    const tick = async () => {
      try {
        const { combineStats } = await import('@/lib/apollo/freeze-cache')
        const s = combineStats()
        if (!alive) return
        const total = s.progress?.total ?? 0
        loadingRef.current = total ? { done: s.progress?.done ?? 0, total, error: s.lastError } : null
      } catch { /* not in a studio that bakes */ }
    }
    void tick()
    const iv = setInterval(tick, 4000)
    return () => { alive = false; clearInterval(iv) }
  }, [inStudio])
  const handle = useRef<SpeechHandle | null>(null)
  /** Set when recording instead of using the browser's recogniser. */
  const recorder = useRef<Recording | null>(null)
  const available = useRef(false)

  useEffect(() => {
    available.current = isSpeechAvailable()
    setMode(readVoiceMode())
    setSpeaks(speechEnabled())
    setStudio(studioVoice())
    // Dev-only handle on the speaking module (window.__beaconSpeak).
    //
    // The studio voice is an optimisation in front of something that already
    // worked, so what matters about it is how it FAILS — a refused request, a
    // dead URL, no network. Those are unreachable through the UI, which only
    // ever calls speak() the one happy way, and each of them has to end with
    // the browser voice saying the thing anyway and reporting that it finished.
    if (process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_DAW_HOOKS === '1') {
      (window as unknown as { __beaconSpeak?: typeof speak }).__beaconSpeak = speak
    }
    modeRef.current = readVoiceMode()
    const on = hudOn()
    setHudState(on)
    applyHud(on)
    const sens = voiceSensitivity()
    setSensitivityState(sens)
    sensitivityRef.current = sens
    const auto = aiActs()
    setAiAutoState(auto)
    aiAutoRef.current = auto
    const am = assistantMode()
    setAssistState(am)
    assistRef.current = am
    const ear = preferredTranscriber()
    setEarState(ear)
    setEnterRuns(readVoiceEnter())
    setCaption(readVoiceCaption())
  }, [])

  /** The last thing the microphone reported, for the planners that need more
   *  than words.
   *
   *  Only two things do. A spoken BEAT is entirely a question of WHEN each
   *  syllable landed, and an assistant relays words with no times - so the
   *  timings have to come from the transcript directly. And "what notes are
   *  being played" needs the playhead, which is a moment rather than part of
   *  the song, so it is not in the project either. */
  // Read inside a callback that must not be rebuilt every time the click is
  // toggled — recreating the recorder's options mid-session is how a held-open
  // microphone gets restarted underneath somebody.
  const metronomeOnRef = useRef(false)
  useEffect(() => { metronomeOnRef.current = metronome }, [metronome])

  /**
   * What is selected, and WHEN it was selected.
   *
   * Brae: "the voice control should keep track of what I'm selecting in case I
   * say something like 'this track'. This would supersede context if the item
   * is selected after the previous context was created."
   *
   * Two jobs. It REMEMBERS, so "this track" still resolves a moment after
   * clicking somewhere that clears the selection - the last thing you pointed
   * at is still the thing you were talking about. And it TIMES the pointing, so
   * the assistant can be told that a click happened after the sentence it is
   * still holding in mind. A conversation carries forty messages; a click
   * carries one meaning, and it is the newer of the two.
   */
  const lastSelection = useRef<{ trackId: string | null; clipId: string | null }>({ trackId: null, clipId: null })
  const selectedAt = useRef(0)
  const lastReplyAt = useRef(0)
  useEffect(() => {
    // Clearing a selection is not pointing at anything, so it does not count as
    // a new statement about what "this" means - it just leaves the last one
    // standing.
    if (!selectedTrackId && !selectedClipId) return
    lastSelection.current = { trackId: selectedTrackId ?? null, clipId: selectedClipId ?? null }
    selectedAt.current = Date.now()
  }, [selectedTrackId, selectedClipId])

  /**
   * A recording asked for by voice, waiting on one question.
   *
   * Brae: "When the user begins sequencer recording or piano roll recording
   * using the voice controls, it will ask if the user wants the metronome.
   * Either way, the program will [do] an audible countdown then start."
   */
  interface PendingTake {
    editor: 'sequencer' | 'pianoroll'
    clipId: string
    lane?: string | null
    bars?: number
  }
  const [pendingTake, setPendingTake] = useState<PendingTake | null>(null)
  const [taking, setTaking] = useState<string>('')

  const heardRef = useRef<Heard | undefined>(undefined)
  const voiceCtx = useCallback(() => ({
    words: heardRef.current?.words,
    // ⚠️ THE WHOLE SENTENCE, because one call cannot tell an edit from a move.
    // "go to bar 9" and "make the reverb 20% at bar 9" reach the planner as the
    // same locate, and only the words separate them. See notAMove.
    said: saidRef.current.join(' '),
    atBeat: engine?.currentBeat,
    // The library, so a preset can be chosen by CHARACTER inside the executor —
    // "one of the darker piano presets" is a question about what is installed
    // on this machine, and the executor cannot see the machine. Carries the
    // sampled range and the preset's own shaping, which is what "darker" and
    // "low notes" are actually measured against.
    // How far the bake has got, so "is it still loading" can be answered. Read
    // fresh each time — it is a moment, not a document, and a stale answer to
    // that question is worse than no answer.
    loading: loadingRef.current,
    library: combinePresets(projectRef.current?.presets).map(p => ({
      id: p.id, name: p.name, group: p.group,
      loNote: p.loNote, hiNote: p.hiNote, fx: p.sound?.fx ?? null,
      // What it IS and what anybody called it — the type comes from the
      // category, the character is measured from the shaping, and a tag the
      // author wrote beats both. See lib/sound-tags.ts.
      category: p.category ?? null, tags: p.tags ?? null,
    })),
  }), [engine])

  /**
   * Measure the tracks and move the faders to match.
   *
   * From the audit's "needs work" list. The measurement is the whole feature:
   * anybody can move a fader, and the thing that is hard by ear is knowing by
   * HOW MUCH — which is a number nobody has until the tracks have been rendered
   * and weighed.
   *
   * ⚠️ Measured over the first 32 beats rather than the whole song. A full
   * project is one offline render per track, and a balance that takes a minute
   * is one nobody waits for. Thirty-two beats is long enough for the gate to
   * have real material to work with and short enough to come back while you are
   * still thinking about the question.
   */
  const runBalance = useCallback(async (job: { trackIds: string[]; referenceId: string | null }) => {
    const project = projectRef.current
    if (!project) return
    try {
      setTaking('Measuring the tracks…')
      const [{ measureTrackLoudness }, { matchGainDb, applyGainDb }] = await Promise.all([
        import('@/lib/song-video/render-audio'),
        import('@/lib/loudness'),
      ])
      const end = Math.min(
        32,
        Math.max(...(project.arrangementClips ?? []).map(c => c.startBeat + c.durationBeats), 8),
      )
      const measured = await measureTrackLoudness(project, job.trackIds, { startBeat: 0, endBeat: end })
      const heard = measured.filter(m => Number.isFinite(m.lufs))
      if (heard.length < 2 && !job.referenceId) {
        respond('I could only hear one of those tracks, so there is nothing to balance it against.', 'problem')
        setTaking(''); return
      }

      // The target: the reference track if they named one, otherwise the middle
      // of what is there. The MEDIAN rather than the mean, so one very loud or
      // very quiet track does not drag every other fader after it.
      const ref = job.referenceId ? heard.find(m => m.trackId === job.referenceId) : null
      if (job.referenceId && !ref) {
        respond('I could not hear the track you wanted to match to.', 'problem')
        setTaking(''); return
      }
      const sorted = [...heard].map(m => m.lufs).sort((a, b) => a - b)
      const target = ref ? ref.lufs : sorted[Math.floor(sorted.length / 2)]

      const nameOf = (id: string) => (project.tracks ?? []).find(t => t.id === id)?.name ?? 'a track'
      const moves: string[] = []
      for (const m of heard) {
        if (ref && m.trackId === ref.trackId) continue
        const delta = matchGainDb(m.lufs, target)
        // Under a decibel is not audible and not worth reporting as a change —
        // a balance that claims to have moved six tracks when it moved none is
        // a balance nobody believes twice.
        if (Math.abs(delta) < 1) continue
        const track = (project.tracks ?? []).find(t => t.id === m.trackId)
        const next = applyGainDb(track?.volume ?? 0.8, delta)
        // ⚠️ UPDATE_TRACK with a patch — there is no SET_TRACK_VOLUME action,
        // and an unknown type falls through the reducer silently, so this would
        // have reported six fader moves and made none.
        dispatch({ type: 'UPDATE_TRACK', trackId: m.trackId, patch: { volume: next } } as never)
        moves.push(`${nameOf(m.trackId)} ${delta > 0 ? 'up' : 'down'} ${Math.abs(delta).toFixed(1)} dB`)
      }

      respond(moves.length
        ? `Balanced${ref ? ` to ${nameOf(ref.trackId)}` : ''}: ${moves.join(', ')}.`
        : 'They are already within a decibel of each other — nothing worth moving.')
    } catch (err) {
      respond(`I could not measure that: ${String(err).slice(0, 80)}`, 'problem')
    } finally {
      setTaking('')
    }
  }, [dispatch, respond])

  /** Apply one planned action. Transport is the engine, everything else the
   *  reducer — shared so the local and assistant paths cannot drift apart. */
  /**
   * The short words said while browsing.
   *
   * ⚠️ FREE, ALWAYS. Hunting for a sample is dozens of one-word commands said
   * quickly while listening — if any of them reached the assistant, finding a
   * sound would be the most expensive thing anybody does in the studio.
   *
   * ⚠️ AND THEY ARE NOT SPOKEN BACK. The whole point is to hear the SOUND; a
   * voice reading out every name over the top of it would make browsing worse
   * than scrolling. The name is shown, not said.
   */
  /**
   * Every command and what became of it, to the server — whichever rung
   * answered, and including the ones that failed.
   *
   * ⚠️ Brae: "They should all be in the record... all voice commands and
   * responses have been read by previous iterations." They had not been.
   * Only the assistant's COMPLETED exchanges were written, so the two truncated
   * replies that ended his last session were nowhere, and neither was a single
   * command the built-in rules answered. A record that keeps the successes and
   * drops the failures says everything works.
   *
   * Fire and forget, and unable to fail: the command has already run.
   */
  /**
   * What the current command has DONE so far, in words — one line per reducer
   * action, filled by runAction and emptied when the next sentence arrives.
   * The transcript shows it beside the reply.
   */
  const didRef = useRef<string[]>([])

  const postExchange = useCallback((e: {
    said: string; calls?: VoiceCall[]; say?: string; outcome: string; turns?: number
    path: 'rules' | 'learned' | 'shared' | 'macro' | 'assistant' | 'failed'
  }) => {
    // The request is over: whatever it dispatched is one undo step, and the
    // next dispatch — a click, a drag — belongs to nothing.
    endUndoGroup?.()
    // The transcript, for the person: said / replied / did.
    // Brae: "It would say what the user said, what Light responded with, and
    // what Light did."
    recordExchange({
      said: e.said,
      source: heardRef.current ? 'spoken' : 'typed',
      reply: e.say ?? (e.path === 'failed' ? e.outcome : ''),
      problem: e.path === 'failed' || /^refused/.test(e.outcome),
      path: e.path,
      did: didRef.current.splice(0),
    })
    void fetch('/api/voice/gap', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        said: e.said,
        calls: e.calls ?? [],
        say: e.say ?? '',
        source: heardRef.current ? 'spoken' : 'typed',
        outcome: e.outcome,
        turns: e.turns ?? 1,
        path: e.path,
        tracks: (projectRef.current?.tracks ?? []).map(t => t.name),
      }),
    }).catch(() => {})
  }, [])

  const runBrowse = useCallback((b: BrowseAction) => {
    const show = (item: { name: string; detail: string } | null) => {
      setBusy(false)
      if (item) setSaid(item.detail ? `${item.name} — ${item.detail}` : item.name)
    }
    if (b === 'stop') {
      const it = currentItem()
      stopAudition()
      setBusy(false)
      respond(it ? `Stopped browsing. The last one was "${it.name}".` : 'Stopped browsing.')
      return
    }
    if (b === 'pick') {
      const it = currentItem()
      const st = auditionState()
      stopAudition()
      setBusy(false)
      if (!it) { respond('Nothing was playing.'); return }
      // ⚠️ A PICK PLACES IT. Brae: "When showing I will be able to select one."
      // This used to name the item and stop, on the grounds that the track and
      // the bar were decisions nobody had made out loud. But a browse is HOW
      // you choose, and choosing that leaves nothing in the song is a browse
      // that has to be followed by a second command to say the same thing.
      // The decisions are made the way the library's own drag-and-drop makes
      // them: a beat lands on the drum track (or a new one, with the kit it was
      // heard on), a recipe on a new track with the instrument it was heard on,
      // a sound on a new track — all at the bar the playhead is in — and the
      // read-back says exactly where.
      const p = projectRef.current
      const bar = p?.timeSignatureNum || 4
      const at = Math.max(0, Math.floor((engine?.currentBeat ?? 0) / bar) * bar)
      const barNo = Math.floor(at / bar) + 1
      if (it.kind === 'beat') {
        const drums = (p?.tracks ?? []).find(t => t.instrument?.type === 'drum')
        const trackId = drums?.id ?? crypto.randomUUID()
        if (!drums) {
          dispatch({ type: 'ADD_TRACK', id: trackId, name: 'Drums' } as DawAction)
          dispatch({ type: 'SET_INSTRUMENT', trackId, instrument: structuredClone(it.instrument) } as DawAction)
        }
        const clip = makeMidiClip(trackId, it.name, at, Math.max(bar, it.durationBeats), { isDrumClip: true })
        clip.notes = it.notes.map(n => ({ ...n, id: crypto.randomUUID() }))
        dispatch({ type: 'ADD_CLIP', clip } as DawAction)
        setSelectedClipId?.(clip.id)
        setExpandedStepSeqClipId?.(clip.id)
        respond(`Added "${it.name}" on ${drums ? drums.name : 'a new Drums track'} at bar ${barNo}.`)
        return
      }
      if (it.kind === 'recipe') {
        const onPreset = it.usePreset && st?.preset
        const instrument = onPreset ? st.preset! : it.instrument
        const trackId = crypto.randomUUID()
        dispatch({ type: 'ADD_TRACK', id: trackId, name: it.name } as DawAction)
        dispatch({ type: 'SET_INSTRUMENT', trackId, instrument: structuredClone(instrument) } as DawAction)
        const clip = makeMidiClip(trackId, it.name, at, Math.max(bar, it.durationBeats), { isDrumClip: false })
        clip.notes = it.notes.map(n => ({ ...n, id: crypto.randomUUID() }))
        dispatch({ type: 'ADD_CLIP', clip } as DawAction)
        setSelectedClipId?.(clip.id)
        setExpandedPianoRollClipId?.(clip.id)
        respond(`Added "${it.name}" on a new track${onPreset && st?.presetName ? ` playing ${st.presetName}` : ''} at bar ${barNo}.`)
        return
      }
      // A sound: an audio clip, the way a drop from the library makes one.
      void (async () => {
        try {
          const { libraryFulfill } = await import('@/lib/default-samples')
          const e = await libraryFulfill(it.id)
          if (!e?.audioBlob) { respond(`I could not load "${it.name}" to place it.`, 'problem'); return }
          const trackId = crypto.randomUUID()
          dispatch({ type: 'ADD_TRACK', id: trackId, name: it.name } as DawAction)
          const url = URL.createObjectURL(e.audioBlob)
          const clip = makeAudioClip(trackId, it.name, at, 8, { audioUrl: url, libraryId: e.id })
          dispatch({ type: 'ADD_CLIP', clip } as DawAction)
          const buf = await engine?.loadClipBuffer(clip)
          if (buf && engine) {
            dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: {
              waveformPeaks: extractPeaks(buf), durationBeats: engine.secondsToBeats(buf.duration), bufferDuration: buf.duration,
            } } as DawAction)
          }
          setSelectedClipId?.(clip.id)
          respond(`Added "${it.name}" on a new track at bar ${barNo}.`)
        } catch {
          respond(`I could not place "${it.name}".`, 'problem')
        }
      })()
      return
    }
    if (b === 'pause') { audition.pause(); setBusy(false); return }
    if (b === 'resume') { audition.resume(); setBusy(false); return }
    if (b === 'faster' || b === 'slower') {
      const r = audition.rate(b === 'faster' ? 1.25 : 0.8)
      setBusy(false)
      setSaid(`${r.toFixed(2)}×`)
      return
    }
    show(b === 'next' ? audition.next()
      : b === 'back' ? audition.back()
      : b === 'restart' ? audition.restart()
      : audition.again())
  }, [respond, dispatch, engine, setSelectedClipId, setExpandedStepSeqClipId, setExpandedPianoRollClipId])

  // The panel follows what is playing, without anybody being talked at. The
  // steering words live HERE, on the panel, and are no longer spoken — Brae:
  // "It shouldn't tell me what commands to say either."
  useEffect(() => onAudition(() => {
    const it = currentItem()
    if (it) setSaid(`${it.detail ? `${it.name} — ${it.detail}` : it.name}   ·   next · back · again · this one · done`)
  }), [])

  const runAction = useCallback((a: unknown) => {
    const act = a as { type: string; action?: string; beat?: number }
    // Every action, in words, for the transcript — what CHANGED, beside what
    // was claimed. Named by the project's own track and clip names.
    {
      const p = projectRef.current
      didRef.current.push(describeAction(a, {
        track: id => p?.tracks.find(t => t.id === id)?.name ?? 'the track',
        clip: id => { const c = p?.arrangementClips.find(x => x.id === id); return c ? `"${c.name}"` : 'the clip' },
        beatsPerBar: p?.timeSignatureNum || 4,
      }))
    }
    if (act.type === 'TRANSPORT') {
      // ── stop() is a PAUSE, and locate carries a beat ────────────────────
      //
      // Two commands were reporting work they had not done.
      //
      // RESTART said "Restarted from the top" and did not go to the top.
      // daw-engine's stop() says so itself — "preserve position (pause, not
      // rewind)" — so stop-then-play resumes exactly where it was. A rewind
      // needs seek(0) between them.
      //
      // LOCATE said "Moved to bar 9" and started playing from wherever the
      // playhead already was. The planner emits { action: 'locate', beat },
      // and the beat fell into an `else` that just called play(), so the one
      // piece of information in the command was dropped.
      //
      // Both are the same fault and the worse kind: the read-back was right
      // and the action was wrong, so the studio told Brae it had done
      // something it had not.
      if (act.action === 'stop' || act.action === 'pause') engine?.stop?.()
      else if (act.action === 'restart') { engine?.stop?.(); engine?.seek?.(0); engine?.play?.() }
      else if (act.action === 'locate') { engine?.seek?.(act.beat ?? 0) }
      else if (act.action === 'toggle') { if (engine?.isPlaying) engine.stop?.(); else engine?.play?.() }
      else engine?.play?.()
      return
    }
    // The click is studio state, not part of the song - same as transport, and
    // for the same reason: nothing about it belongs in the saved document.
    if (act.type === 'METRONOME') { setMetronome?.((act as { on?: boolean }).on !== false); return }

    // ── THE WORKSPACE ─────────────────────────────────────────────────────
    //
    // Brae: "Give Light control over changing visuals, like changing
    // customization options, opening lanes and piano rolls and sequencers."
    //
    // Studio state, like the transport and the click: none of it belongs in the
    // saved document, so none of it is a reducer action. Opening an editor is
    // also the one kind of command that cannot go wrong — nothing is changed,
    // so nothing needs undoing.
    // ── BROWSING ────────────────────────────────────────────────────────
    //
    // Async, so it lives here rather than in the planner — the same division
    // the project commands use. Everything it can fail at says so: an empty
    // shelf is a sentence, not silence.
    if (act.type === 'BROWSE') {
      const b = act as unknown as {
        tag?: string; category?: string; query?: string; asked?: string
        kind?: 'sounds' | 'recipes' | 'beats' | 'both'; preset?: string
      }
      void (async () => {
        try {
          const { libraryGetAll } = await import('@/lib/sound-library')
          // ⚠️ A stub entry has no audio until it is fulfilled — community
          // links and catalog entries stream on first use. Browsing is exactly
          // the case that meets those, so it must go through the same path the
          // library's own preview does rather than reading audioBlob and
          // finding nothing.
          const { libraryFulfill } = await import('@/lib/default-samples')
          const all = await libraryGetAll()
          const kind = b.kind ?? 'both'

          const sounds: AuditionItem[] = kind === 'recipes' || kind === 'beats'
            ? []
            : buildQueue(all, { tag: b.tag, category: b.category, query: b.query })

          // ── Beats: the drum patterns, on the song's kit ──────────────────
          //
          // Brae: "it should instead activate the sounds of drum beats one after
          // another. When showing I will be able to select one."
          //
          // Played on the kit the song's drum track already uses, so what is
          // heard is what a pick will place; the default kit if there is none.
          let beats: AuditionItem[] = []
          if (kind === 'beats') {
            const { getPatterns, DEFAULT_KIT } = await import('@/lib/drum-presets')
            const drums = (projectRef.current?.tracks ?? []).find(t => t.instrument?.type === 'drum')
            const kit = drums?.instrument ?? DEFAULT_KIT.instrument
            beats = beatItems(getPatterns(), kit, projectRef.current?.tempo || 100, { tag: b.tag, query: b.query })
          }

          // ── Recipes, as notes to play ────────────────────────────────────
          //
          // Built here rather than in the planner because build() is the
          // recipe's own function and the catalog is loaded lazily — and
          // because the tempo they should play at is the SONG's, not a number
          // chosen in a library module. A recipe heard at the speed you are
          // working is a recipe you can judge.
          let recipes: AuditionItem[] = []
          if (kind === 'recipes' || kind === 'both') {
            const { getAllChordRecipes } = await import('@/lib/practice-recipes')
            const bpm = projectRef.current?.tempo || 100
            recipes = getAllChordRecipes().flatMap(r => {
              let built
              try { built = r.build() } catch { return [] }
              const item: AuditionItem = {
                kind: 'recipe', id: r.id, name: r.title,
                detail: r.tagline || r.genre || 'recipe',
                tags: recipeTags(r),
                notes: built.notes.map(n => ({
                  pitch: n.pitch, startBeat: n.startBeat,
                  durationBeats: n.durationBeats, velocity: n.velocity,
                })),
                durationBeats: built.durationBeats,
                bpm,
                instrument: built.instrument,
                // ⚠️ A drum recipe keeps its kit whatever the preset is. Its own
                // flag says whether it minds, and hats on a grand piano is not
                // a preference anybody expressed.
                usePreset: built.usePreset && !built.isDrumClip,
              }
              return matchesWant(item, { tag: b.tag, query: b.query }) ? [item] : []
            })
          }

          const items = [...beats, ...recipes, ...sounds]
          if (!items.length) {
            respond(`I could not find anything ${b.asked || 'like that'}.`, 'question')
            return
          }

          // Grand piano unless they named something else — and if the named one
          // is not in the library, say so rather than quietly using a default
          // they did not ask for.
          const wanted = (b.preset || '').trim()
          const preset = presetFromLibrary(all, wanted || 'grand piano')
          const missed = wanted && !presetFromLibrary(all, wanted)

          startAudition(items, b.asked ?? '', async id => {
            const e = await libraryFulfill(id)
            return e?.audioBlob ?? null
          }, preset)

          // ⚠️ SAY HOW MANY, THEN PLAY. Brae: "It shouldn't tell me what
          // commands to say either." The words that steer a browse are read
          // on the panel, where they cost nothing; spoken, they were a sentence
          // of instructions between the person and the first sound every time.
          const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
          const parts = [
            beats.length && plural(beats.length, 'beat'),
            recipes.length && plural(recipes.length, 'recipe'),
            sounds.length && plural(sounds.length, 'sound'),
          ].filter(Boolean) as string[]
          const what = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]
          respond(
            `${what} ${b.asked || ''}`.trim() + '. '
            + (recipes.length && preset ? `Recipes on ${preset.name}. ` : '')
            + (missed ? `I could not find a "${wanted}" to play them on. ` : ''),
          )
        } catch {
          respond('I could not reach your library just now.', 'problem')
        }
      })()
      return
    }

    if (act.type === 'VIEW_ACTION') {
      const v = act as unknown as { view: string; clipId?: string; trackId?: string; open?: boolean }
      const open = v.open !== false
      // The voice card's own bars — the list of commands, the transcript, the
      // settings. Opening one opens the card too, or the bar has nothing to be
      // beside.
      if (v.view === 'help' || v.view === 'transcript' || v.view === 'settings' || v.view === 'usage' || v.view === 'macros') {
        if (open) { setSide(v.view); setPanelOpen(true) }
        else setSide('none')
        return
      }
      if (v.view === 'pads') setShowPads?.(open)
      else if (v.view === 'colours') setShowAppearance?.(open)
      else if (v.view === 'pianoroll') setExpandedPianoRollClipId?.(open ? (v.clipId ?? null) : null)
      else if (v.view === 'sequencer') setExpandedStepSeqClipId?.(open ? (v.clipId ?? null) : null)
      else if (v.view === 'devices') {
        if (open && v.trackId) {
          // Select it too: the rack follows the selection, so opening it on a
          // track nobody has selected would show somebody else's devices.
          setSelectedTrackId?.(v.trackId)
          setApolloRack?.({ trackId: v.trackId, seed: null, follow: true })
        } else setApolloRack?.(null)
      }
      return
    }

    // ⚠️ THE PROJECT AS A DOCUMENT — opening, versioning, going back.
    //
    // Asynchronous, which is why it cannot be a reducer action and is not one:
    // the planner stays pure and hands over an intent, and the network lives
    // here. Everything says what happened, including the failures — a version
    // that did not save while the studio said it had is worse than one that
    // never tried.
    if (act.type === 'PROJECT_ACTION') {
      const a = act as unknown as { action: string; name?: string }
      const projectId = projectRef.current?.id
      void (async () => {
        try {
          if (a.action === 'open') {
            const res = await fetch('/api/projects')
            // ⚠️ A bare ARRAY, not { projects }. Checked rather than assumed —
            // the guess would have found nothing, every time, silently.
            const body = await res.json()
            const list: { id: string; name?: string }[] = Array.isArray(body) ? body : (body?.projects ?? [])
            const want = (a.name ?? '').toLowerCase().trim()
            // Exact first, then a contained match — "open winter drift" should
            // find "Winter Drift" and also "Winter Drift v2" if that is all
            // there is, but never prefer the longer one when both exist.
            const hit = list.find((p: { name?: string }) => (p.name ?? '').toLowerCase() === want)
              ?? list.find((p: { name?: string }) => (p.name ?? '').toLowerCase().includes(want))
            if (!hit) { respond(`I could not find a project called "${a.name}".`, 'question'); return }
            router.push(`/projects/${hit.id}`)
            return
          }
          if (a.action === 'new') {
            // ⚠️ THE STUDIO, NOT THE CHOOSER. Brae: "when I say to add a new
            // DAW project it opens a project from All Projects so it isn't DAW
            // specific and it needs naming which it can't do."
            //
            // Bare /create is the module picker: it asks which kind of project
            // and waits at a name field — a field Light cannot type into, so
            // the request stopped dead one step from done. These two parameters
            // are what the projects page itself uses for "new song", and they
            // take you straight into the DAW.
            //
            // ⚠️ And the name has to travel WITH it. /create ignored a name
            // parameter entirely, so a project asked for by name arrived
            // called "New Project" — which is why naming felt impossible.
            const q = new URLSearchParams({ modules: 'audio', audioMode: 'music' })
            if (a.name) q.set('name', a.name)
            router.push(`/create?${q}`)
            return
          }
          if (!projectId) { respond('This project has not been saved yet, so there is nothing to version.', 'question'); return }

          if (a.action === 'save_version') {
            const res = await fetch(`/api/projects/${projectId}/versions`, {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ name: a.name }),
            })
            if (!res.ok) respond('I could not save that version.', 'question')
            return
          }
          if (a.action === 'list_versions' || a.action === 'restore_version') {
            const res = await fetch(`/api/projects/${projectId}/versions`)
            const versions = (await res.json())?.versions ?? []
            if (!versions.length) { respond('There are no saved versions of this project yet.'); return }
            if (a.action === 'list_versions') {
              respond(`${versions.length} version${versions.length === 1 ? '' : 's'}: ${versions.map((v: { name: string }) => v.name).join(', ')}.`)
              return
            }
            const want = (a.name ?? '').toLowerCase().trim()
            const hit = versions.find((v: { name?: string }) => (v.name ?? '').toLowerCase() === want)
              ?? versions.find((v: { name?: string }) => (v.name ?? '').toLowerCase().includes(want))
            if (!hit) { respond(`I could not find a version called "${a.name}".`, 'question'); return }
            const one = await fetch(`/api/projects/${projectId}/versions/${hit.id}`)
            // Returns the stored document itself, not { data }. The DAW project
            // lives inside it — a version holds the whole file, modules and all.
            const doc = await one.json()
            const data = doc?.dawProject ?? doc
            // ⚠️ LOAD_PROJECT replaces everything on screen. It is on the
            // audit's unreachable list precisely because it is the biggest
            // single action there is — so it only ever runs from a sentence
            // that named a version out loud.
            if (data) dispatch({ type: 'LOAD_PROJECT', project: data } as never)
            else respond('That version would not load.', 'question')
            return
          }
        } catch {
          respond('I could not reach your projects just now.', 'question')
        }
      })()
      return
    }

    // ⚠️ GOING SOMEWHERE. Not a change to the song, and not something the
    // reducer could do — it is a change of screen. Possible at all because
    // Light is mounted in the layout now: mounted in the transport bar, this
    // action would have destroyed the component performing it.
    if (act.type === 'NAVIGATE') {
      const to = (act as unknown as { to?: string }).to
      if (to) router.push(to)
      return
    }

    // Which editor is on screen is also the studio, not the song.
    if (act.type === 'OPEN_EDITOR') {
      const a = act as unknown as { editor: 'sequencer' | 'pianoroll'; clipId: string }
      if (a.editor === 'pianoroll') { setExpandedStepSeqClipId?.(null); setExpandedPianoRollClipId?.(a.clipId) }
      else { setExpandedPianoRollClipId?.(null); setExpandedStepSeqClipId?.(a.clipId) }
      return
    }

    // ⚠️ SELECTING IS THE STUDIO, NOT THE SONG — and nothing was handling it.
    // The executor emits SELECT from four places and says "Selected 3 clips on
    // Bass", but the reducer has no such action and this function did not catch
    // it either, so the sentence reported success and selected NOTHING. That
    // matters more than it looks: the selection is what "this track" and "this
    // clip" resolve against, so a failed select left every following pronoun
    // pointing at whatever was selected before.
    if (act.type === 'SELECT') {
      const a = act as unknown as { clipIds?: string[]; trackId?: string }
      const ids = a.clipIds ?? []
      setSelectedClipIds?.(new Set(ids))
      // The single-selection field drives the editors, which only ever open one
      // clip. One selected clip is that clip; several is not a single anything.
      setSelectedClipId?.(ids.length === 1 ? ids[0] : null)
      if (a.trackId) setSelectedTrackId?.(a.trackId)
      return
    }

    // Already applied by the planner - the shorthand lives in a module, not in
    // the project, and there is nothing for the reducer to do with it.
    if (act.type === 'VOCAB') return

    // The history belongs to the editor, so undo cannot be a reducer action.
    // Handled HERE rather than only in the local path, because the assistant
    // can call undo too and used to be told the studio had never heard of it.
    if (act.type === 'UNDO' || act.type === 'REDO') {
      const step = act.type === 'UNDO' ? undo : redo
      const did = step?.()
      if (!step) setProblem('Undo is not available here.')
      else if (!did) setProblem(act.type === 'UNDO' ? 'Nothing to undo.' : 'Nothing to redo.')
      else setSaid(act.type === 'UNDO' ? 'Undone.' : 'Redone.')
      return
    }

    // Measuring means RENDERING, which is asynchronous and needs an audio
    // context — neither of which the planner has. So it is a job, like a take.
    if (act.type === 'BALANCE_LEVELS') {
      void runBalance(act as unknown as { trackIds: string[]; referenceId: string | null })
      return
    }

    // A whole conversation of its own: ask about the click, count in, listen.
    if (act.type === 'RECORD_TAKE') {
      setPendingTake(act as unknown as PendingTake)
      return
    }
    dispatch(act as never)
  }, [dispatch, engine, setMetronome, setExpandedStepSeqClipId, setExpandedPianoRollClipId,
      setShowPads, setApolloRack, setShowAppearance, setSelectedTrackId, runBalance, undo, redo])

  /**
   * Record a spoken take: count in, listen, and write down what was said.
   *
   * ── Why the recorder starts BEFORE the count-in ──────────────────────────
   *
   * The grid needs an origin — the moment beat one happened — in the
   * recording's own timeline, and the only way to know that is to have the
   * recording already running when it arrives. Counting in first and then
   * opening the microphone would leave the startup latency between them
   * unmeasured, and at 120bpm a sixteenth is 125ms: a hundred milliseconds of
   * unaccounted-for delay is most of a subdivision, so everything lands late
   * and the first hit misses the downbeat.
   *
   * The clicks are therefore IN the recording. That is harmless: they happen
   * before the origin, and both the negative-step guard and the in-order
   * word/onset walk skip them.
   */
  const runTake = useCallback(async (take: PendingTake, withClick: boolean) => {
    const bpm = projectRef.current?.tempo || 120
    const bars = Math.max(1, Math.min(8, take.bars ?? 1))
    const beatsPerBar = projectRef.current?.timeSignatureNum || 4
    if (withClick) setMetronome?.(true)

    let rec: Awaited<ReturnType<typeof startRecording>> = null
    try {
      setTaking('Getting ready…')
      rec = await startRecording({
        // The syllables ARE the message here, so the filler words stay.
        beat: true,
        vocabulary: [...COMMAND_VOCABULARY],
        playing: !!engine?.isPlaying,
        sampleRate: engine?.ctx?.sampleRate,
        audioContext: engine?.ctx,
      })
      if (!rec) { respond(micProblemMessage(), 'problem'); setTaking(''); return }

      // Audible either way — Brae asked for the countdown whether or not the
      // click is on afterwards.
      const t0 = performance.now()
      setTaking('Counting in…')
      await engine?.countIn?.(beatsPerBar, bpm)
      const originSec = (performance.now() - t0) / 1000

      const seconds = (bars * beatsPerBar * 60) / bpm
      setTaking(take.lane ? `Say the ${take.lane} part…` : 'Say it…')
      // A tail, so the last syllable is not clipped by the stopwatch.
      await new Promise(r => setTimeout(r, (seconds + 0.7) * 1000))

      setTaking('Working it out…')
      const out = await rec.stop()
      rec = null
      if (!out.ok) { respond(out.error, 'problem'); setTaking(''); return }
      const words = (out.result?.words ?? []).map(w => ({ word: w.word, s: w.s, e: w.e }))
      if (!words.length) { respond('I did not catch anything in that take.', 'problem'); setTaking(''); return }

      // ── The audio spikes ────────────────────────────────────────────────
      //
      // Brae: "the program connects those names to the audio spikes from the
      // user saying the words". Without the audio the words carry their own
      // times, which are close enough to read and too loose to play.
      let onsets: ReturnType<typeof detectOnsets> = []
      try {
        if (out.audio && engine?.ctx) {
          const buf = await engine.ctx.decodeAudioData(await out.audio.arrayBuffer())
          onsets = detectOnsets(monoOf(buf), buf.sampleRate)
        }
      } catch { /* no spikes: the word times still make a take, and it says so */ }

      const opts = { bpm, originSec, maxBars: bars, onlyLane: (take.lane ?? undefined) as never }
      const built = take.editor === 'pianoroll'
        ? chordTake(words, onsets, opts)
        : drumTake(words, onsets, opts)

      if (!built.hits.length) {
        respond(take.editor === 'pianoroll'
          ? 'I did not hear any chords in that. Try naming them, or say something like "one means C major".'
          : 'I did not hear any drums in that. Try "kick clap kick kick crash".', 'problem')
        setTaking(''); return
      }

      const clip = (projectRef.current?.arrangementClips ?? [])
        .find(c => c.id === take.clipId) as { notes?: unknown[]; durationBeats?: number } | undefined
      const fresh = takeToNotes(built, () => crypto.randomUUID(), take.editor === 'pianoroll' ? 1 : undefined)
      dispatch({
        type: 'UPDATE_CLIP',
        clipId: take.clipId,
        // ADDED to what is there, because building a kit one drum at a time is
        // the whole point of a single-lane take — replacing would mean each
        // pass erased the last one.
        patch: {
          notes: [...((clip?.notes ?? []) as never[]), ...(fresh as never[])],
          durationBeats: Math.max(clip?.durationBeats ?? 0, built.bars * beatsPerBar),
        },
      } as never)

      const how = built.fromAudio ? '' : ' (timed from the words — I could not hear the attacks)'
      const missed = built.ignored.length ? ` I skipped ${built.ignored.slice(0, 3).join(', ')}.` : ''
      respond(`Got it: ${describeTake(built)}.${missed}${how}`)
    } catch (err) {
      respond(`The take failed: ${String(err).slice(0, 80)}`, 'problem')
    } finally {
      rec?.cancel?.()
      setTaking('')
    }
  }, [dispatch, engine, respond, setMetronome])

  /**
   * The one question a take always asks.
   *
   * It goes through pendingAsk2, which is the studio's ordinary way of asking
   * something — so it appears inside the voice window with the rest of the
   * conversation, and is answerable by saying yes or by clicking.
   */
  useEffect(() => {
    if (!pendingTake) return
    const take = pendingTake
    setPendingTake(null)
    setPendingAsk2({
      speak: `Recording ${take.lane ? `the ${take.lane}` : take.editor === 'pianoroll' ? 'chords' : 'a beat'}. Do you want the click?`,
      options: [
        {
          label: 'Yes, with the click',
          calls: [],
          // What a person actually says to answer this.
          keywords: ['yes', 'yeah', 'yep', 'click', 'metronome', 'please', 'sure', 'on'],
          onPick: () => { void runTake(take, true) },
        },
        {
          label: 'No click',
          calls: [],
          keywords: ['no', 'nope', 'without', 'off', 'none', 'silent'],
          onPick: () => { void runTake(take, false) },
        },
      ],
    })
  }, [pendingTake, runTake])

  /** Send a finished sentence to the assistant and run whatever comes back. */
  const run = useCallback(async (
    spoken: string,
    heardConfidence = 1,
    confirmed = false,
    /** Everything the recogniser reported, when this came from a microphone.
     *  Typed commands have no such thing and pass only the words. */
    heard?: Heard,
  ) => {
    // Kept for the planners: a typed command clears it, so a beat can never be
    // built from the timings of a previous, unrelated sentence.
    heardRef.current = heard
    setSpokenRaw(spoken)
    // ── One request, one undo ──────────────────────────────────────────────
    // Brae: "If I ask it to do 4 things in one request, an undo request after
    // that should undo the whole thing." Everything this sentence dispatches —
    // four rule calls, a macro's dozen points, an assistant's turns — lands in
    // one history group, closed when the exchange is recorded.
    beginUndoGroup?.(spoken)
    // ── Was this meant for the studio at all? ───────────────────────────────
    //
    // Brae: "The 'say light first' thing needs to go. It isn't working for me."
    //
    // It was a toll, and it was charged on the wrong thing. The idea was sound —
    // a microphone held open across a room hears people who are not talking to
    // it, and nothing acoustic can tell you that somebody across the room saying
    // "stop" did not mean you. The name was the disambiguator.
    //
    // In practice it failed in both directions at once. It did not reliably
    // WAKE — "light" is a short, soft word that the recogniser renders as
    // "late", "right", "like" — so the studio ignored real commands from
    // somebody sitting right in front of it. And it charged that toll on
    // sentences that were unmistakably meant for it: Brae said "execute", which
    // is not a command the rules resolve, so it failed the looksLikeCommand
    // test, so it was dropped as room noise and reported as "not acted on".
    // The one word whose entire job is to approve a queue could not get through
    // the gate guarding the queue.
    //
    // So the name is no longer required. It is still UNDERSTOOD — saying
    // "light, mute the drums" works and always did, and stripWakeWord below
    // still removes it — it is simply not demanded.
    //
    // What replaces it is a quieter rule that costs nothing to satisfy: in a
    // held-open session, act on what the built-in commands can actually read,
    // and let anything else pass without comment. A room having a conversation
    // produces sentences the rules cannot read, so it still produces nothing —
    // but it produces nothing SILENTLY, instead of asking somebody to say a
    // magic word first.
    const heardFrom = spoken

    // `let`: a sentence cut in half is rejoined below before anything reads it.
    let text = stripWakeWord(heardFrom)
    if (!text) {
      // ⚠️ NOT while a question is on screen. With the microphone held open,
      // the pause after the studio asks something is full of room noise, and
      // each empty take used to overwrite the display with "I didn't get
      // that" — so the card said it had failed while the question it was
      // waiting on sat right there, still answerable. Nothing was wrong; it
      // just looked like everything was.
      // ⚠️ Nor while a command is still being worked on. With the microphone
      // held open, the pause AFTER speaking is a take of its own — room noise,
      // a breath — and it would arrive empty and report failure while the
      // sentence before it was still with the assistant. The command then
      // succeeded, on top of an error about nothing.
      //
      // ⚠️ AND NOT IN THE SECONDS AFTER ONE LANDED. Brae: "it has a habit of
      // saying 'I didn't catch that', then doing what I wanted. Is it deciding
      // that it didn't catch it before it has finished processing?"
      //
      // It was, in the one window the two flags above do not cover. Speaking
      // ends before `busy` begins — the take has to be transcribed first — so
      // the pause right after a sentence arrives as its own empty take while
      // the real one is still in the post. Both statements were then true at
      // once and the failure was on screen first, being the one that had
      // nothing to wait for.
      //
      // Four seconds of quiet after something was accepted belongs to that
      // command, not to a new one that failed.
      const settling = Date.now() - lastAcceptedAt.current < 4000
      // ⚠️ AND NOT WHILE ANYTHING IS STILL IN FLIGHT. Brae: "it needs to stop
      // saying 'I didn't catch that' just because it's still loading /
      // processing a response, command, or set of commands." A half-sentence
      // being held for its other half, words still arriving on the microphone,
      // a reply still being spoken — each is a reason an empty take is not a
      // failure, only a pause.
      const midway = !!heldFragment.current || Date.now() < userSpeakingUntil.current + 2500 || talking
      if (!askingRef.current && !busyRef.current && !settling && !midway) setProblem('I didn\'t catch that.')
      return
    }

    // ── Browsing takes the short words ──────────────────────────────────────
    //
    // Before the rules, and before any gate that costs money. Inside a browse
    // "next" and "faster" are unambiguous; outside one they were never words
    // this file knew. The mode is visible in the panel and one of its own words
    // ends it, which is what makes taking them over safe.
    // Answering a question is the same command still being given; anything
    // else starts a new one.
    saidRef.current = askingRef.current ? [...saidRef.current, text].slice(-4) : [text]
    if (auditionActive()) {
      const b = readBrowseCommand(text)
      if (b) {
        lastAcceptedAt.current = Date.now()
        runBrowse(b)
        // A browse word is an exchange too — the transcript should show
        // "next" and "this one", or a browse reads as a silence.
        recordExchange({
          said: text, source: heardRef.current ? 'spoken' : 'typed', reply: '', problem: false, path: 'browse',
          did: [b === 'pick' ? 'Chose the sound that was playing' : b === 'stop' ? 'Stopped browsing' : `Browse: ${b}`, ...didRef.current.splice(0)],
        })
        return
      }
    }

    // The context the reading is judged against: the project's real track names,
    // their current levels (so "turn the bass up" knows where the bass IS), and
    // the tempo (so "a bit faster" has something to be faster than). A reading
    // that cannot see these has to guess, and guessing is what this whole path
    // exists to avoid.
    const ctx = {
      tracks: project.tracks ?? [],
      tempo: project.tempo,
      // So "louder" and "mute this" mean the track being worked on. Nobody
      // says a track's name twenty times in a row.
      // The live selection, or the last one there was. Clicking a clip clears
      // the track selection on some surfaces, and "mute this track" a second
      // later still means the track you were just on.
      selectedTrackName: (project.tracks ?? [])
        .find(t => t.id === (selectedTrackId ?? lastSelection.current.trackId))?.name,
      // So "duplicate it" and "delete this" mean the clip on screen. Selecting
      // something is a statement about what you are working on, and the studio
      // should not need to be told twice.
      selectedClipId: selectedClipId ?? lastSelection.current.clipId ?? undefined,
      // So "Bass body 1" reads as one target — a track and an item said
      // together, which is the most specific thing anybody can say and was the
      // one form the rules could not see.
      clips: (project.arrangementClips ?? []).map(c => ({
        id: c.id, name: c.name, trackId: c.trackId,
      })),
      // The sound library, so "make the bass a violin" can find the violin. It
      // is not part of the song — it lives on this machine — which is why the
      // rules resolve the name here and hand the executor an id.
      library: combinePresets(project.presets).map(p => ({
        id: p.id, name: p.name, group: p.group,
      })),
    }

    // ── Is this about the queue rather than about the song? ────────────────
    //
    // Checked before the parser, because "execute" and "read them back" are
    // things you say TO the studio about the conversation, not things you can
    // do to a track.
    const control = readQueueControl(text)
    if (control) {
      lastAcceptedAt.current = Date.now()
      setBusy(false)
      if (control === 'collect') {
        setCollecting(true); collectingRef.current = true
        respond('Collecting. Say what you want and then "execute".')
        return
      }
      if (control === 'immediate') {
        setCollecting(false); collectingRef.current = false
        respond(queue.length ? `Acting immediately again. ${queue.length} still collected.` : 'Acting immediately again.')
        return
      }
      if (control === 'read') { respond(readBack(queue), 'question'); return }
      if (control === 'clear') { setQueue([]); offeredAt.current = 0; respond('Cleared.'); return }
      if (control === 'run') { runQueueRef.current?.(); return }
    }

    // ── Was this meant for the studio at all? ───────────────────────────────
    //
    // Placed HERE, after the queue words, and asking the real interpreter — both
    // of which are the fixes rather than incidental.
    //
    // After the queue words, because "execute" resolves to no command (it is
    // about the LIST, not the song) and the old guard therefore threw it away as
    // room noise. Asking the real interpreter, because the cheap pre-check this
    // first used is deliberately narrow: it reads "mute the drums" and does not
    // read "take the bass up", so a gate built on it would have silently ignored
    // real commands — swapping one kind of not-listening for another.
    // ⚠️ THE OTHER HALF OF A SENTENCE THAT WAS CUT IN TWO.
    // Brae: "when I talk more slowly it thinks that I'm saying different
    // sentences." Waiting longer cannot fix that alone: on the recorder path
    // our VAD already waits 2.2 seconds, but a browser using SpeechRecognition
    // is endpointed by the BROWSER, well under a second, with no setting for
    // it. So the repair happens here, above both paths.
    //
    // Only ever when the new words read as nothing on their own AND the joined
    // version reads as something — joining two sentences that were meant to be
    // separate would run a command nobody asked for, which is far worse than
    // failing to join one that was split.
    let readable = interpret(text, ctx).calls.length > 0
    if (!readable) {
      const held = heldFragment.current
      const joined = stitch(held, text, Date.now())
      if (joined && interpret(joined, ctx).calls.length > 0) {
        text = joined
        readable = true
        heldFragment.current = null
        setTaking('')
      } else if (joined && held && looksIncomplete(held.text)) {
        // ── The half that trailed off, and the half that finished it ────────
        //
        // Brae: "'On Pad Intro...' then there's a 3 second wait, 'descend the
        // volume from 100% to 60%'. That is a broken up sentence but the same
        // idea. Would the stitcher be able to take care of that?"
        //
        // ⚠️ IT COULD NOT, and this is why. The join above only stood when the
        // built-in RULES could read the result — and an automation is the
        // assistant's job, so the joined sentence read as nothing to the rules
        // and the two halves went their separate ways: the first spent a turn
        // being asked about, the second went to the model without its target.
        //
        // When the held half was itself unfinished (no verb — a place or a
        // thing, with nothing to do to it yet) the join is not two sentences
        // pushed together, it is one sentence put back. It goes onward whole,
        // to whichever rung can read it.
        text = joined
        heldFragment.current = null
        setTaking('')
      }
    }
    if (readable) heldFragment.current = null

    // ── Half a sentence, held for its other half ─────────────────────────────
    //
    // ⚠️ THIS IS WHAT LETS THE SILENCE TAIL BE SHORT. With the recorder waiting
    // 1.2 seconds rather than 2.2, a pause to think cuts a sentence in half far
    // more often. A half with no verb in it is not a command and not a
    // question; sending it to the assistant buys a turn spent asking "what
    // about the pad intro?" — which the speaker was about to answer anyway.
    // So it waits, quietly, for up to STITCH_MS. If nothing follows, THEN it is
    // asked about, once, with the words repeated so a mishearing is visible.
    if (!readable && !heldFragment.current && looksIncomplete(text)) {
      const at = Date.now()
      heldFragment.current = { text, at }
      setBusy(false)
      window.setTimeout(() => {
        const still = heldFragment.current
        if (!still || still.at !== at) return
        heldFragment.current = null
        respond(`I heard "${still.text}" — what would you like to do with it?`, 'question')
      }, STITCH_MS)
      return
    }

    // ── "…and the hats": the rest of a command that already ran ─────────────
    //
    // Brae: "Is there a way that we can make that sentence work in the program?
    // Those pauses are part of natural speech and if we can respect them then
    // we will get further."
    //
    // The first half was whole — "mute the drums" — and ran, correctly, when
    // the tail ended. What arrives now opens with a connective or has no verb
    // of its own; it is not a new command, it is the same one continuing. So
    // it is read as the WHOLE sentence, joined to the words that ran a moment
    // ago, and only the part that has not happened yet is carried out: the
    // calls that already ran are subtracted from whatever the joined sentence
    // plans to. That is what keeps "move the drums two bars… and the hats" from
    // moving the drums four.
    let alreadyRan: VoiceCall[] = []
    const lastRun = lastRunRef.current
    if (!readable && lastRun && Date.now() - lastRun.at <= CONTINUE_MS && continuesPrevious(text)) {
      text = `${lastRun.text} ${text}`
      alreadyRan = lastRun.calls
      saidRef.current = [text]
      setTaking('')
    }

    if (!shouldActOn({
      held: !!heard && continuousRef.current,
      collecting: collectingRef.current,
      // pendingAsk belongs here with the rest: "yes" reads as no command at
      // all, so without it the answer to the studio's own question is dropped
      // as overheard chatter before it ever reaches the handler below.
      //
      // ⚠️ AND SO DOES askingRef — THE ASSISTANT'S OWN QUESTIONS.
      // Brae: "it answers in a way that asks for specifics then doesn't know
      // what to do when I give them because it forgets."
      //
      // The structured asks were all listed here; the free-form one the
      // assistant itself raises — "which track did you mean?" — was not. Its
      // answer is exactly the kind of sentence this gate throws away: "the bass
      // one" reads as no command at all. So the studio asked a question and
      // then stopped listening for the reply, which is indistinguishable from
      // forgetting it had asked. Read off the ref so this does not rebuild the
      // handler on every keystroke of a question being typed.
      answering: confirmed || pendingAsk !== null || !!askingRef.current
        || !!pendingAsk2 || !!pendingOffer || !!pendingName,
      readable,
      // Already handled above; named here so the rule reads completely.
      queueWord: !!control,
      assistantActs: assistRef.current === 'auto',
      // ⚠️ Permission to act is not permission to spend. Everything the room
      // says was reaching the model — "yeah", "one sec", somebody else's
      // conversation — and each is a paid turn to discover nobody was talking
      // to the studio. Track and clip names count as naming something, so
      // "the pad" is a request and "mm" is not.
      looksLikeRequest: worthTheModel(text, [
        ...(project.tracks ?? []).map(t => t.name),
        ...(project.arrangementClips ?? []).map(c => c.name).filter(Boolean),
      ] as string[]),
    })) {
      setBusy(false)
      // ⚠️ Kept, not discarded. This is exactly where half a slowly-spoken
      // sentence dies: unreadable on its own, dropped as overheard. Holding it
      // costs nothing and gives the rest of the sentence something to join.
      if (worthHolding(text, false)) heldFragment.current = { text, at: Date.now() }
      // Silently. With the name no longer required this is the ordinary fate
      // of an overheard sentence rather than a correctable mistake, and the
      // card shows the sentence in progress rather than a log to record it in.
      return
    }

    // ── One breath, possibly several commands ──────────────────────────────
    //
    // Typed or spoken: running two commands together is the same problem either
    // way, and somebody typing "solo the pad set the tempo to 132" means both.
    {
      // ⚠️ NOT WHEN THE ASSISTANT IS GOING TO ANSWER. Brae: "the AI has so many
      // rules that it follows that it doesn't actually know what to do... I
      // think the rules make it have a harder time doing other things."
      //
      // This block SPLIT a sentence with the rules and then EXECUTED every
      // piece with the rules, and returned — so in assistant mode a sentence
      // the splitter recognised never reached the model at all. That is how
      // "change the name of the item drums 1 to drums 2" became a time
      // signature change: a rule matched a fragment of it and ran.
      //
      // The splitter is good at what it is for and stays in charge when the
      // assistant is off. With it on, one model that can see the whole sentence
      // beats several rules that can each see a piece of it.
      // ⚠️ WIDENED FROM aiAuto TO "the assistant is on at all".
      //
      // Brae: "It also says that it didn't catch it before it says there's an
      // API error, so I think that it's trying to execute complex commands
      // before the AI has even tried to process it."
      //
      // Exactly right, and the first gate was too narrow. aiAuto means the
      // assistant acts WITHOUT ASKING; with it merely enabled, this block still
      // split the sentence with the rules, ran the pieces, and reported "I
      // didn't catch that" — all before the assistant had seen a word of it.
      // Two verdicts on one sentence, the rules' one first.
      //
      // If a model is going to read this sentence, the rules do not get to
      // answer for it. They advise (see the hint sent with the request); they
      // do not pre-empt.
      const segments = assistantMode() !== 'rules' && !assistantDownRef.current ? [] : interpretSequence(text, ctx)
      if (segments.length > 1) {
        lastAcceptedAt.current = Date.now()
        setBusy(false)
        const collected: QueuedCommand[] = []
        const ran: string[] = []
        const failed: string[] = []
        for (const seg of segments) {
          const plan = planVoiceCalls(seg.reading.calls, project, voiceCtx())
          if (plan.problem) { failed.push(plan.problem); continue }
          if (collectingRef.current) {
            collected.push({ text: seg.text, say: plan.say, calls: seg.reading.calls })
          } else {
            for (const a of plan.actions) runAction(a)
            ran.push(plan.say)
          }
        }
        if (collected.length) {
          setQueue(q => [...q, ...collected])
          lastQueuedAt.current = Date.now()
          respond(`Collected ${collected.length}: ${collected.map(c => c.say).join(' ')}`)
        } else if (ran.length) {
          respond(ran.join(' '))
        } else {
          // Held for the same reason as at the attention gate: this may be
          // the first half of something, and the words are being thrown away
          // anyway. See lib/voice/stitch.ts.
          if (worthHolding(text, false)) heldFragment.current = { text, at: Date.now() }
          respond(failed[0] ?? 'I didn\'t catch that.', 'problem')
        }
        return
      }
    }
    setBusy(true); setProblem(''); setSaid(''); setAsking(''); setPendingAsk(null)
    setChoices(null); setPendingDo(null)

    // ── Try to answer it here first ──────────────────────────────────────────
    //
    // The assistant is the current implementation of this step, not the
    // feature. Everything downstream consumes VoiceCall[], and a regular
    // expression produces exactly the same shape a model does — so the common
    // commands ("play", "mute the pad", "set the tempo to 128") can be answered
    // locally, instantly and for nothing, while the assistant keeps the ones
    // that need judgement.
    //
    // BOTH confidences have to hold. Badly heard and badly understood are
    // different failures with the same cure, and a wrong local answer is worse
    // than a slow correct one: it is silent, free, and therefore frequent.
    // ── If a question is on the table, this is the answer to it ────────────
    //
    // Routed before the parser, because an answer is not a command: "the track"
    // and "yes" and "Intro" mean nothing on their own and everything in reply
    // to what was just asked.

    // ── "Ask first" has to be answerable out loud ──────────────────────────
    //
    // Brae: "ask first should have the machine confirm before doing something,
    // not just skip doing it altogether."
    //
    // He was describing it exactly. The confirmation could only ever be
    // answered by clicking it or pressing Enter in its text box — there was no
    // voice path to "yes" at all. So in a voice session it did skip: you said
    // something, a box appeared, and unless you reached for the keyboard
    // nothing whatsoever happened. A confirmation you cannot answer in the
    // medium you are working in is a refusal with extra steps.
    if (pendingAsk !== null) {
      const yn = readYesNo(text)
      if (yn === true) {
        const t = pendingAsk.trim()
        setPendingAsk(null)
        if (t) { void run(t, 1, true) }
        return
      }
      if (yn === false) {
        setPendingAsk(null)
        setBusy(false)
        respond('Left it.')
        return
      }
      // Anything else is a change of subject rather than an answer. The
      // question goes away and the new sentence is treated on its own terms —
      // people move on, and holding a stale question over them is worse than
      // dropping it.
      setPendingAsk(null)
    }

    if (pendingAsk2) {
      const picked = readChoice(text, pendingAsk2.options)
      if (picked == null) {
        // Not an answer. It might be a change of subject, and a studio you
        // cannot walk away from mid-question is worse than one that never asks:
        // if the words are a command in their own right, the question is
        // abandoned and the command runs. Only genuine mumbling gets re-asked.
        // The SAME context the command path reads — clips, library, selection.
        // A reduced one could not read "duplicate Pad 1" as a command, so a
        // change of subject that named a clip was re-asked the old question.
        const asCommand = heard ? resolveHeard(heard, ctx) : resolveLocally(text, ctx)
        const givingUp = /^(cancel|never ?mind|forget it|nothing|stop)\b/i.test(text.trim())
        if (givingUp) {
          setPendingAsk2(null)
          setBusy(false)
          setSaid('Dropped it.')
          return
        }
        if (!confidentEnough(asCommand, heardConfidence)) {
          setBusy(false)
          respond(`I didn't catch which one. ${pendingAsk2.speak}`, 'question')
          return
        }
        setPendingAsk2(null)
        // Falls through to the normal path below, which will run it.
      } else {
        const option = pendingAsk2.options[picked]
        const offer = pendingAsk2.offer
        setPendingAsk2(null)
        // A studio-level answer: no calls, a closure instead. See AskOption.
        if (option.onPick) { setBusy(false); option.onPick(); return }
        const plan = planVoiceCalls(option.calls, project, voiceCtx())
        setBusy(false)
        if (plan.problem) { respond(plan.problem, 'problem'); return }
        for (const a of plan.actions) runAction(a)
        // The offer comes after the thing they asked for, never instead of it.
        if (offer) {
          setPendingOffer(offer)
          respond(`${plan.say} ${offer.speak}`, 'question')
        } else {
          respond(plan.say)
        }
        return
      }
    }

    if (pendingOffer) {
      const yes = readYesNo(text)
      if (yes === null) {
        // Neither yes nor no. An offer is the easiest thing in the world to
        // ignore by just carrying on, so carrying on is allowed.
        // The SAME context the command path reads — clips, library, selection.
        // A reduced one could not read "duplicate Pad 1" as a command, so a
        // change of subject that named a clip was re-asked the old question.
        const asCommand = heard ? resolveHeard(heard, ctx) : resolveLocally(text, ctx)
        if (confidentEnough(asCommand, heardConfidence)) {
          setPendingOffer(null)
          // Falls through and runs.
        } else {
          setBusy(false)
          respond(`Sorry — ${pendingOffer.speak}`, 'question')
          return
        }
      }
      if (yes !== null) {
      setBusy(false)
      const offer = pendingOffer
      setPendingOffer(null)
      if (!yes) { setSaid('Left as it is.'); return }
      setPendingName(offer)
      respond(offer.prompt, 'question')
      return
      }
    }

    if (pendingName) {
      const offer = pendingName
      setPendingName(null)
      setBusy(false)
      // Whatever they said IS the name. No parsing, no vocabulary, no
      // correction — a name is the one input where the studio has no business
      // deciding it misheard, because there is nothing to check it against.
      const fresh = text.trim().replace(/[.!?]+$/, '')
      if (!fresh) { respond('I did not catch a name.', 'problem'); return }
      const plan = planVoiceCalls(
        [{ name: offer.call.name, input: { ...offer.call.input, [offer.call.field]: fresh } }],
        project,
        voiceCtx(),
      )
      if (plan.problem) { respond(plan.problem, 'problem'); return }
      for (const a of plan.actions) runAction(a)
      respond(plan.say)
      return
    }

    // resolveHeard when the utterance came from a microphone: it can weigh what
    // the recogniser was unsure of, which is the difference between recovering
    // a mishearing and reporting one.
    const local0 = heard ? resolveHeard(heard, ctx) : resolveLocally(text, ctx)
    // A continuation re-reads the whole sentence; the half that already ran is
    // taken back out before anything runs again. See notAlreadyRun.
    const local = alreadyRan.length ? { ...local0, calls: notAlreadyRun(local0.calls, alreadyRan) } : local0

    // ── Is there a studio to talk to? ──────────────────────────────────────
    //
    // Light now lives in the layout, so it is alive on the dashboard, in the
    // library, everywhere — which means it hears song commands in rooms that
    // have no song. The empty project makes those resolve to nothing found,
    // and the dispatch would throw.
    //
    // ⚠️ So it says so, and says what would fix it. Failing silently here would
    // be the same bug this file has been chasing all week, just with a better
    // excuse.
    // ⚠️ Only the commands that genuinely need a song. Refusing everything was
    // refusing the very commands that get you into a project — "start a new
    // project" was answered with "there is no project open".
    if (!inStudio && local.calls.length && !needsNoProject(local.calls)) {
      setBusy(false)
      respond('There is no project open, so there is nothing to change yet. Open one and ask me again.')
      return
    }

    // ── The commands the editor carries out itself ───────────────────────────
    //
    // Undo needs the editor's history stack, which is not part of the project
    // and cannot be — so it is the one family that does not become reducer
    // actions. Intercepted here rather than pretended at in the executor.
    // ⚠️ With the assistant on, the rules step back — see runsLocally. They were
    // acting first on anything they felt confident about, so a wrong rule could
    // not be corrected by the model that was supposed to be in charge. Undo and
    // redo are on the instant list, so this still fires.
    const localRuns = runsLocally(local, heardConfidence, assistantMode())
    if (localRuns) {
      const name = local.calls[0]?.name
      if (name === 'undo' || name === 'redo') {
        const step = name === 'undo' ? undo : redo
        const did = step?.()
        setBusy(false)
        // Reports what actually happened. Saying "Undone." over an empty stack
        // is the kind of small lie that teaches someone to stop trusting the
        // read-back, and the read-back is the whole safety story here.
        if (!did) setProblem(name === 'undo' ? 'Nothing to undo.' : 'Nothing to redo.')
        else if (!step) setProblem('Undo is not available here.')
        // Says how much came back when a whole request did — "Undone — 4
        // changes" is the difference between trusting the undo and checking it.
        else setSaid(`${name === 'undo' ? 'Undone' : 'Redone'}${typeof did === 'number' && did > 1 ? ` — ${did} changes` : ''}.`)
        return
      }
    }

    if (localRuns) {
      const plan = planVoiceCalls(local.calls, project, voiceCtx())
      if (!plan.problem && local.destructive && !confirmed) {
        // Understood perfectly, and still not run: the read-back says exactly
        // what would be lost, and a person presses the button.
        setBusy(false)
        setPendingDo({ label: plan.say, calls: local.calls })
        return
      }
      // The executor found more than one thing the words could mean, and
      // declined to pick. That is a question, not a failure.
      if (plan.ask) {
        // Understood well enough to have a question about, which is plenty of
        // evidence that somebody is talking to the studio.
        lastAcceptedAt.current = Date.now()
        setBusy(false)
        setPendingAsk2(plan.ask)
        respond(plan.ask.speak, 'question')
        return
      }
      // Collecting: understood, described, and NOT done. The whole point is
      // that a command can be taken back before it has happened.
      if (!plan.problem && collectingRef.current && !local.destructive) {
        setBusy(false)
        lastAcceptedAt.current = Date.now()
        lastQueuedAt.current = Date.now()
        setQueue(q => [...q, { text, say: plan.say, calls: local.calls }])
        respond(`Collected: ${plan.say}`)
        return
      }
      if (!plan.problem) {
        const before = project
        for (const a of plan.actions) runAction(a)
        remember({
          said: text, heard: heardConfidence, by: 'local',
          matched: local.matched, understood: local.confidence,
          calls: local.calls, said_back: plan.say,
        })
        recordCommand({ said: text, by: local.calls.some(c => c.name === 'run_macro') ? 'macro' : 'rules' })
        lastRunRef.current = { text, calls: [...alreadyRan, ...local.calls], at: Date.now() }
        postExchange({ said: text, calls: local.calls, say: plan.say, outcome: 'ran',
          path: local.calls.some(c => c.name === 'run_macro') ? 'macro' : 'rules' })
        history.current = []
        setAsking('')
        // A reading of a REWRITTEN sentence says so. Acting silently on words
        // nobody said is how someone learns not to trust the thing — and if the
        // rewrite was wrong, seeing it is the only way they find out.
        const spokenBack = local.rewrittenFrom
          ? `${plan.say} (heard "${local.rewrittenFrom}")`
          : plan.say
        // Anything worth mentioning about what this changed — a forgotten solo,
        // a name collision just created. Computed against the project as it was
        // BEFORE, which is why it is captured above.
        // What the project WILL be, worked out with the same reducer the studio
        // uses. Dispatch is asynchronous, so reading the real after-state here
        // would read the before-state and every notice would compare a project
        // to itself; replaying the actions gives the honest answer immediately
        // and cannot drift, because it is not a second implementation.
        const after = (plan.actions as DawAction[]).reduce(dawReducer, before)
        lastAcceptedAt.current = Date.now()
        const notice = noticeFor(before, after)
        respond(notice ? `${spokenBack} ${notice}` : spokenBack)
        setBusy(false)
        return
      }
      // Local built something the executor rejected — fall through, since that
      // is precisely a case local does not yet understand well enough.
    }

    // ── Understood, but two ways ─────────────────────────────────────────────
    //
    // ⚠️ ALSO NOT WHEN THE ASSISTANT IS ON. Being asked to choose between two
    // rule readings is a reasonable thing to do when the rules are the only
    // interpreter. When a model is about to read the same sentence — with the
    // song, the selection and the last ten commands in front of it — stopping
    // to ask which of two rule guesses was meant is worse than simply letting
    // it answer.
    if (assistantMode() === 'rules' && local.calls.length && local.alternatives?.length) {
      const readings = [
        { id: local.matched, calls: local.calls },
        ...local.alternatives,
      ]
      const offered = readings
        .map(r => ({ label: planVoiceCalls(r.calls, project, voiceCtx()).say, calls: r.calls }))
        .filter(r => r.label)
      if (offered.length > 1) {
        setBusy(false)
        setChoices(offered)
        return
      }
    }

    // ── The barrier ──────────────────────────────────────────────────────────
    //
    // Past this line costs credits. A mishearing that reaches the assistant
    // spends money to act on a sentence nobody said, so it stops here and shows
    // what it heard. Every time — not the first time, not when unsure: the
    // whole point is that a wrong transcript is indistinguishable from a right
    // one until a person reads it.
    // Switched off entirely. Not the same as "ask me first": this is somebody
    // saying they do not want a model in the loop at all, so the honest answer
    // is that the studio does not know this sentence — and where to change that
    // if they want to. Offering to spend anyway would make the setting
    // decorative.
    // ── Already worked out once ─────────────────────────────────────────────
    //
    // The assistant answered this exact sentence before and the studio kept the
    // CALL it produced, so this runs for nothing. Placed here deliberately: the
    // rules still go first, and this sits in front of every gate that costs
    // money — which means anything taught once keeps working with the assistant
    // switched off, and keeps working when the Lumens run out.
    //
    // The names are resolved against the song as it is NOW, by the same planner
    // the assistant's own calls go through. That is the whole reason the call is
    // what gets stored: "mute the pad" finds today's pad.
    const learned0 = recallCommand(text)
    const learned = learned0 && alreadyRan.length
      ? { ...learned0, calls: notAlreadyRun(learned0.calls, alreadyRan) }
      : learned0
    if (learned) {
      const before = project
      const plan = planVoiceCalls(learned.calls, project, voiceCtx())
      if (!plan.problem && !plan.ask && plan.actions.length) {
        for (const a of plan.actions) runAction(a)
        remember({
          said: text, heard: heardConfidence, by: 'learned',
          matched: 'learned', understood: 1,
          calls: learned.calls, said_back: plan.say,
        })
        recordCommand({
          said: text,
          by: learned.calls.some(c => c.name === 'run_macro') ? 'macro'
            : learned.from === 'shared' ? 'shared' : 'learned',
        })
        lastRunRef.current = { text, calls: [...alreadyRan, ...learned.calls], at: Date.now() }
        postExchange({
          said: text, calls: learned.calls, say: plan.say, outcome: 'ran',
          path: learned.calls.some(c => c.name === 'run_macro') ? 'macro'
            : learned.from === 'shared' ? 'shared' : 'learned',
        })
        setAsking('')
        const after = (plan.actions as DawAction[]).reduce(dawReducer, before)
        lastAcceptedAt.current = Date.now()
        const notice = noticeFor(before, after)
        respond(notice ? `${plan.say} ${notice}` : plan.say)
        setBusy(false)
        return
      }
      // ⚠️ The song has moved on and the remembered call no longer fits it —
      // the track was renamed, the effect deleted. Forgetting it here is what
      // stops a stale answer being given twice: the sentence goes to the
      // assistant as though it had never been learned, and is learned again
      // from the answer that works.
      //
      // Only the EXACT entry. A template that failed to plan is not wrong, it
      // has been handed a name this song does not have — throwing away the
      // whole family because one member missed would undo the generalisation
      // the first time somebody named a track that does not exist.
      if (learned.from === 'exact') forgetKey(learned.key)
    }

    if (assistRef.current === 'rules') {
      setBusy(false)
      respond(
        `I don't know how to do that with the built-in commands, and the assistant is off. `
        + `Turn it on in Settings if you want me to work it out.`,
        'problem',
      )
      return
    }

    // ⚠️ SAY SO, AND STOP. Brae: "It should inform me and not work instead of
    // just running off of the browser version."
    //
    // Once the assistant has refused for billing it will refuse every time, and
    // the sentences that reach this line are exactly the ones the built-in
    // commands could not read. Going quiet here left the simple commands still
    // working and everything else doing nothing, which reads as the studio
    // getting worse for no stated reason rather than as an account that needs
    // topping up. Better to be told once per sentence than to be left guessing.
    //
    // Cleared by the next assistant turn that succeeds, so topping up or fixing
    // the account recovers on its own with nothing to dismiss.
    if (outOfLumens.current) {
      setBusy(false)
      respond(
        `I'm out of ${LUMENS_NAME}, so I can't work that one out. `
        + `The built-in commands still work — top up to get the rest back.`,
        'problem',
      )
      return
    }

    if (!confirmed && !aiAutoRef.current) {
      setBusy(false)
      setPendingAsk(text)
      return
    }
    // That is the activation Brae described — "full AI integration ... only when
    // activated" — and it is the only thing that skips this. Off unless
    // somebody deliberately turns it on, because it is the switch that lets a
    // misheard sentence spend money without anybody seeing it first.

    // ── The assistant's turn, as a loop ──────────────────────────────────────
    //
    // Brae: "I want to lean into the AI version."
    //
    // This was one shot: ask, receive tool calls, execute them, forget. The
    // model never found out what any of them did, which is why the system
    // prompt had to SHOUT that one sentence can hold several requests — with no
    // second turn there was nowhere to continue, so everything had to be got
    // right blind, first time.
    //
    // ⚠️ AND IT STAYED ONE SHOT FOR A LONG TIME WITHOUT ANYBODY NOTICING. The
    // loop below replied to the model with its results — but only when the
    // route sent back the model's own turn (`raw`), and the route never did.
    // So every exchange broke out after the first turn: a refused call was
    // reported to nobody (the "I couldn't find that" sentence only ever went
    // into the ledger), the model could not fix anything, and the prompt was
    // promising results that never arrived. Turns 2+ have never been paid for
    // in this studio, which is worth knowing when reading the cost model.
    //
    // WHAT GOES BACK NOW, AND WHEN. A second turn is a second bill — the whole
    // cached prefix again plus the conversation so far — so it is only bought
    // when it can change the outcome:
    //
    //   a call was REFUSED: the reason goes back and the model gets to fix it
    //   (name the right track, use the field the refusal named). This is the
    //   whole point of refusing out loud, and it costs about what asking the
    //   person to say it again would — except they do not have to.
    //
    //   everything RAN: stop. The studio's own read-back is the report, the
    //   prompt tells the model not to repeat it, and a "done" turn would spend
    //   a whole prefix to say nothing. The song summary already carries what a
    //   `describe` would have told it, so there is no read-then-act to fund.
    //
    //   the model ANSWERED IN WORDS: that is a question or an explanation for
    //   the person, and the exchange waits for them.
    //
    // ⚠️ Bounded twice over: by turns, and by the model repeating itself — the
    // same refusal twice means it is not going to find the answer, and the
    // person should hear the refusal rather than pay for a third try.
    const MAX_TURNS = 4
    // ⚠️ A TURN CAN HANG, AND FOUR OF THEM HANG FOUR TIMES AS LONG.
    //
    // This was one request; making it a loop quietly made the worst case four
    // sequential requests, and the client had no timeout at all — the route
    // allows 90s and the model call itself 60s, so the control could sit busy
    // for minutes. Busy disables the mic AND swallows Enter, so what that looks
    // like from the outside is the voice control freezing: you type the command
    // again, nothing happens, again, nothing happens.
    //
    // So: each turn gets a deadline, and the whole loop gets a budget. Running
    // out is a failure with a sentence, not an unexplained silence.
    const TURN_MS = 30_000
    const LOOP_MS = 75_000
    const loopStartedAt = Date.now()

    // ── Say something while it thinks ───────────────────────────────────────
    //
    // Brae: "If it is processing, it can just say 'Processing' or 'Give me a
    // moment to do that' or 'Of course'."
    //
    // ⚠️ ONLY IF IT IS ACTUALLY SLOW. Announcing every command would put a
    // second sentence in front of every answer, including the ones that arrive
    // before anybody could have wondered. A second and a bit is about where a
    // pause stops reading as speed and starts reading as nothing happening.
    //
    // No timer to clear: the token makes a stale acknowledgement impossible,
    // and `busy` going false is the honest test of whether there is still
    // anything to wait for — so an answer that beat the clock silences it.
    const ackAt = ++ackToken.current
    window.setTimeout(() => {
      if (ackToken.current === ackAt && busyRef.current) respond(WORKING[ackAt % WORKING.length])
    }, 1200)

    traceStart(text)
    const msgs: { role: 'user' | 'assistant'; content: unknown }[] =
      [...history.current, { role: 'user' as const, content: text }]
    let lastSay = ''
    let spoke = ''
    const allCalls: VoiceCall[] = []
    /** The calls of the turn that RAN — the lesson, if there is one. */
    let ranCalls: VoiceCall[] = []
    /** The last turn's refusal. Cleared by a turn that ran, so a fixed
     *  mistake is not filed as a failure. */
    let lastProblem = ''
    /** The refusal before that, to notice the model repeating itself. */
    let priorProblem = ''
    let usedTurns = 0
    // What the whole exchange consumed, added up across its turns.
    const spend = { tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, credits: 0 }

    try {
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        usedTurns = turn + 1
        if (Date.now() - loopStartedAt > LOOP_MS) {
          setProblem('That took too long — stopping there. Try saying it again.')
          markFailed('loop budget exceeded')
          postExchange({ said: text, calls: allCalls, path: 'failed', outcome: 'loop budget exceeded', turns: usedTurns })
          traceEnd('', 'loop budget exceeded')
          return
        }
        const res = await fetch('/api/ai/assist', {
          method: 'POST',
          signal: AbortSignal.timeout(TURN_MS),
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            module: 'music',
            messages: msgs,
            // ⚠️ What was asked a moment ago. The message array above is
            // cleared whenever a command succeeds — it has to be, since a
            // tool_use turn cannot be replayed without its results — so
            // without this every finished command left no trace and a
            // follow-up had nothing to refer back to.
            // ⚠️ SIX, NOT TEN. Every line here is uncached input on every
            // turn — about 45 tokens each — and the last three exchanges
            // already travel in `messages` as text. Six is enough for "the
            // same on the bass" and "put it back where it was"; ten was
            // paying for commands from a quarter of an hour ago.
            recent: recentContext(6),
            // ⚠️ WHAT THE RULES THOUGHT, AS A SUGGESTION — not as a decision.
            //
            // The hundred hand-written rules know a great deal about this app:
            // which words name a track, what "brighter" does, how people phrase
            // things here. Throwing that away when the assistant is on wastes
            // it; letting it ACT was the problem. Handed over as a reading to
            // consider, the model keeps the knowledge and keeps the judgement.
            hint: local.calls.length
              ? { matched: local.matched, confidence: local.confidence,
                  calls: local.calls.map(c => c.name) }
              : undefined,
            // Re-read every turn: after the first pass the song is not what it
            // was, and a summary from before the edits would have the assistant
            // checking its work against the project it started with.
            stateSummary: musicStateSummary({
              ...projectRef.current,
              // ⚠️ Four words per macro, and it is what lets the assistant
              // START FROM ONE instead of deriving a long move from nothing —
              // cheaper, and much more likely to be right, because there is far
              // less to invent.
              macros: macroNames(),
              selectedTrackId: selectedTrackIdRef.current ?? lastSelection.current.trackId,
              selectedClipId: selectedClipIdRef.current ?? lastSelection.current.clipId,
              // Pointed at since the assistant last spoke, so it outranks
              // anything the conversation is still carrying about some other
              // track. Without this the model has the selection but no way to
              // know it is newer than the sentence it is answering.
              selectionIsNew: selectedAt.current > lastReplyAt.current,
            }),
          }),
        })
        if (!res.ok) {
          const e = await res.json().catch(() => ({} as { error?: string; needCredits?: boolean; detail?: string }))
          // 401 is the route's own answer; 404 is Clerk's middleware refusing an
          // unauthenticated request BEFORE the route runs, which it does with a
          // 404 rather than a 401. Both mean the same thing to a person, and
          // "Couldn't reach the assistant (404)" reads like an outage rather than
          // like "sign in" — which sends people looking for a fault that is not
          // there. The local resolver still handles the common commands either
          // way, so this is a partial loss, not a dead feature.
          const signedOut = res.status === 401 || res.status === 404
          // ⚠️ THE BUILT-IN READ RUNS WHEN THE ASSISTANT CANNOT. Seen on the
          // real path: "mute the pad", read by the rules at 0.93, was sent to
          // the assistant to be confirmed — and with nobody signed in the
          // answer was "Sign in to use the assistant. Simple commands still
          // work without it." while the simple command sat undone. The
          // assistant was only ever asked to CHECK a reading the studio already
          // had; when it cannot, the reading stands.
          if ((signedOut || e.needCredits) && local.calls.length && confidentEnough(local, heardConfidence) && !local.destructive) {
            const plan = planVoiceCalls(local.calls, project, voiceCtx())
            if (!plan.problem && !plan.ask) {
              for (const a of plan.actions) runAction(a)
              setBusy(false)
              respond(plan.say)
              lastRunRef.current = { text, calls: local.calls, at: Date.now() }
              postExchange({ said: text, calls: local.calls, say: plan.say, path: 'rules', outcome: signedOut ? 'ran (assistant needs sign-in)' : `ran (out of ${LUMENS_NAME})` })
              traceEnd(plan.say)
              return
            }
          }
          // And a sentence the rules could not read WHOLE may still read in
          // parts — "mute the pad and mute the drums" is two built-in commands.
          // With the assistant refusing, the sentence is read again the way
          // rules-only mode reads it, once.
          if ((signedOut || e.needCredits) && !assistantDownRef.current) {
            assistantDownRef.current = true
            setBusy(false)
            void run(spoken, heardConfidence, confirmed, heard)
            return
          }
          // Remembered, so the NEXT sentence is answered honestly instead of
          // quietly falling through to the built-in commands.
          if (e.needCredits) outOfLumens.current = true
          // ⚠️ THE REAL REASON, not a generic line. Brae: "It does keep saying
          // that there's an API error." A message that says only that cannot be
          // acted on by him or by me — the upstream status is the whole
          // diagnosis, and it was being thrown away in favour of a tidier
          // sentence. Logged in full as well, because the card is small.
          if (!res.ok && e.detail) console.error('[voice] assistant failed:', e.detail)
          setProblem(
            e.needCredits ? `Out of ${LUMENS_NAME}.`
              : signedOut ? 'Sign in to use the assistant. Simple commands still work without it.'
                : (e.error || `Couldn't reach the assistant (${res.status}).`))
          markFailed(e.error || `http ${res.status}`)
          postExchange({ said: text, calls: allCalls, path: 'failed', outcome: e.error || `http ${res.status}`, turns: usedTurns })
          traceEnd('', e.error || `http ${res.status}`)
          return
        }
        // A turn got through, so whatever was wrong with the account is not
        // wrong any more.
        outOfLumens.current = false
        assistantDownRef.current = false
        const data = await res.json() as {
          message?: string; actions?: (VoiceCall & { id?: string })[]
          credits?: number; balance?: number; stop?: string; raw?: unknown[]
          usage?: { in?: number; out?: number; cacheRead?: number; cacheWrite?: number }
        }
        if (typeof data.credits === 'number') {
          setCredits({ spent: data.credits, left: data.balance ?? 0 })
        }
        // ⚠️ ADDED UP ACROSS TURNS, not per turn. One sentence can take four
        // round trips, and a log that showed them separately would make an
        // ordinary command look like four commands — which is precisely the
        // thing worth SEEING about a multi-turn answer.
        spend.tokensIn += data.usage?.in ?? 0
        spend.tokensOut += data.usage?.out ?? 0
        spend.cacheRead += data.usage?.cacheRead ?? 0
        spend.cacheWrite += data.usage?.cacheWrite ?? 0
        spend.credits += data.credits ?? 0
        // A continuation re-reads the whole sentence; what already ran a moment
        // ago is taken back out before the assistant's plan is carried out.
        const calls = notAlreadyRun(data.actions ?? [], alreadyRan)
        if (data.message?.trim()) spoke = data.message.trim()

        if (!calls.length) {
          // The model answered rather than acted — usually a clarifying question,
          // sometimes a plain answer. Either way it is NOT an error, and showing
          // it as one was the reason clarification could never work: a question
          // styled like a failure invites you to give up, not to reply.
          //
          // After a turn that DID work, the same text is the report of what
          // changed, so it is spoken rather than asked.
          const reply = spoke || 'I couldn\'t turn that into an edit.'
          if (lastSay) { respond(reply); setSaid(reply); history.current = []; setAsking(''); return }
          history.current = [...history.current,
            { role: 'user' as const, content: text },
            { role: 'assistant' as const, content: reply }].slice(-8)
          remember({
            said: text, heard: heardConfidence, by: 'assistant',
            matched: local.matched, understood: local.confidence,
            calls: [], asked: reply,
          })
          // A question still cost its turns — and, since a refusal now goes
          // back to the model, sometimes two. Filed here because this branch
          // returns before the ledger line after the loop.
          recordCommand({ said: text, by: 'assistant', turns: usedTurns, ...spend, problem: lastProblem || undefined })
          traceEnd('', `asked: ${reply}`)
          setAsking(reply)
          // ⚠️ NO LONGER OPENS THE TYPING BOX. Brae: "'Type' needs to stop
          // opening on its own."
          //
          // It opened every time the assistant asked anything back, which is
          // often — and answering a spoken question by voice is the whole point
          // of a voice control. The question is on screen and the microphone is
          // still open; anybody who would rather type can press the button. The
          // one place it still opens itself is a failure that explicitly says
          // typing is the way forward, where not opening it would be telling
          // somebody what to do and making them go and find it.
          return
        }

        // ── Plan the whole batch before running any of it ────────────────────
        //
        // ⚠️ All-or-nothing per turn, deliberately. Running the first half of
        // "loop the bass and play it" and then failing on the second leaves the
        // project half-changed by a command nobody finished giving. So a batch
        // with any bad call executes NOTHING — but, unlike before, the reason
        // goes back to the model, which can now name the right track and try
        // again instead of the user being told "no" and starting over.
        const proj = projectRef.current
        // Each call sees what the calls before it made — see planVoiceCallsEach.
        const plans = planVoiceCallsEach(calls, proj, voiceCtx())
        // The executor found more than one thing the words could mean and
        // declined to pick. That is a question for the PERSON, not for the
        // model — it is their song, and the ambiguity is about which of their
        // tracks they meant. So the loop stops and asks, the same way the
        // local path does.
        const asking = plans.find(pl => pl.ask)
        if (asking?.ask) {
          lastAcceptedAt.current = Date.now()
          setPendingAsk2(asking.ask)
          respond(asking.ask.speak, 'question')
          // Closed here too: an interaction that ends in a question is one of
          // the most interesting kinds, and leaving the trace open would lose it.
          traceEnd('', `asked: ${asking.ask.speak}`)
          return
        }

        const badAt = plans.findIndex(pl => pl.problem)
        const results = calls.map((c, i) => ({
          type: 'tool_result' as const,
          tool_use_id: c.id ?? `call_${i}`,
          is_error: badAt >= 0,
          content: badAt < 0
            ? (plans[i].say || 'done')
            : i === badAt
              ? (plans[i].problem || 'could not be done')
              : 'not run — another call in the same reply could not be done, so nothing was changed',
        }))

        // ⚠️ RECORDED HERE because this is the only place that knows all three:
        // what the model asked for (with its ARGUMENTS), what the studio
        // answered, and what actually changed. A tool NAME on its own explains
        // nothing — set_effect is right for "more reverb" and wrong for "keep
        // reverb up until bar 6", and only the arguments tell them apart.
        traceTurn(
          usedTurns,
          calls.map((c, i) => ({
            name: c.name,
            input: c.input,
            result: String(results[i]?.content ?? ''),
            ok: badAt < 0,
          })),
          badAt < 0 ? plans.flatMap(pl => pl.actions.map(a => String((a as { type?: string }).type ?? 'action'))) : [],
        )

        // ⚠️ One utterance, one record. The obvious place to write these is
        // here, where the calls are — but a loop passes through here several
        // times, so a single sentence would be filed as three or four separate
        // commands and the corpus would count retries as if they were
        // repeated attempts. They are written once, after the loop.
        allCalls.push(...calls)

        if (badAt < 0) {
          for (const pl of plans) for (const a of pl.actions) runAction(a)
          lastSay = plans.map(pl => pl.say).filter(Boolean).join(' ')
          ranCalls = calls.map(c => ({ name: c.name, input: c.input }))
          lastProblem = ''
          setSaid(lastSay)
          // Everything ran and the studio has the sentence for it. A further
          // turn could only repeat that sentence in the model's words, which
          // the prompt tells it not to do — so it is not bought. See the
          // header above.
          break
        }

        // A refusal. Back to the model with the reason, unless it has already
        // been told this and came back with the same thing: then it is not
        // going to find the answer, and the person should hear the refusal
        // rather than pay for another try.
        priorProblem = lastProblem
        lastProblem = plans[badAt].problem || 'refused'
        if (lastProblem === priorProblem) break
        if (turn === MAX_TURNS - 1) break
        if (data.stop !== 'tool_use') break

        // ⚠️ ONLY AS A PAIR, AND ONLY WHEN THERE IS SOMETHING TO PAIR WITH.
        // `data.raw ?? []` posted an EMPTY assistant message whenever the reply
        // carried no raw blocks; the route drops empty messages, which left the
        // tool_result below with no tool_use before it — the 400 that read as
        // "an API error" and cost a whole session. If there is nothing to answer
        // to, there is nothing to answer.
        const raw = Array.isArray(data.raw) ? data.raw : []
        if (!raw.length) break
        msgs.push(
          { role: 'assistant', content: raw },
          { role: 'user', content: results },
        )
      }

      // ── The refusal is SAID, not just filed ──────────────────────────────
      //
      // The old loop only ever put a refusal on screen on its fourth turn, and
      // never reached a fourth turn — so a batch the studio would not run
      // ended in silence after "working on it". Nothing edited, nothing said:
      // the one outcome this file promises never happens. If the model added
      // a sentence of its own it is spoken too, because it usually says what
      // it was trying to do.
      if (lastProblem && !lastSay) {
        respond(spoke ? `${lastProblem} ${spoke}` : lastProblem, 'problem')
      }

      remember({
        said: text, alternatives: undefined, heard: heardConfidence, by: 'assistant',
        matched: local.matched, understood: local.confidence,
        calls: allCalls, said_back: lastSay || spoke,
      })
      recordCommand({ said: text, by: 'assistant', turns: usedTurns, ...spend, problem: lastProblem || undefined })

      // Brae: "Then it executes with AI and sends the system a correction that
      // we can work from when I'm making patches."
      //
      // Now carries the OUTCOME as well as the intention. What the assistant
      // was asked to do is only half a training example; whether it worked is
      // the half that says which readings to fix.
      //
      // Deliberately not awaited and deliberately unable to fail: the command
      // has already run, and a notebook being unavailable must never turn a
      // successful edit into a reported failure.
      if (!lastProblem && allCalls.length) {
        lastRunRef.current = { text, calls: [...alreadyRan, ...allCalls], at: Date.now() }
      }
      postExchange({
        said: text, calls: allCalls, say: lastSay || spoke,
        outcome: lastProblem ? `refused: ${lastProblem}` : allCalls.length ? 'ran' : 'no tool call',
        turns: usedTurns, path: 'assistant',
      })

      // ── Keep the last few exchanges, as TEXT ────────────────────────────
      //
      // Brae: "it isn't remembering the last messages and using them to
      // interpret present chat commands. It should remember a few."
      //
      // ⚠️ THIS USED TO CLEAR EVERYTHING, and the reason was real: replaying a
      // tool_use turn needs its results alongside it, and a conversation
      // carrying one without the other is rejected outright — the exact 400
      // that cost a session. Clearing was the safe answer to that.
      //
      // The safe answer threw away the conversation. What goes back now is only
      // what was SAID — the sentence and the reply, no tool blocks at all — so
      // there is nothing that can be orphaned, and "do that to the bass as
      // well" has a "that" to point at. Six messages is three exchanges: enough
      // for a follow-up to make sense, short enough that a command from ten
      // minutes ago cannot drag the current one somewhere strange.
      //
      // The recentContext() summary stays as well; the two answer different
      // questions. That is a compact record of what was DONE, this is the
      // conversation itself.
      // ⚠️ ONLY A TURN THAT FINISHED CLEANLY. An answer the studio refused, or
      // that ended on a problem, is not one to repeat for free forever — and
      // rememberCommand refuses several more shapes on its own: anything
      // pointing at "that" or "here", anything destructive, and any call
      // carrying a number nobody actually said.
      // ⚠️ AND ONLY A FIRST-TURN ANSWER. A call the model got right after
      // being told why its first try was refused was informed by the refusal
      // as much as by the sentence — "I couldn't find X; I have Pad, Bass,
      // Drums" — and a lesson keyed on the sentence alone would replay that
      // choice into a song where it no longer holds.
      if (!lastProblem && ranCalls.length && usedTurns === 1) {
        const names = [
          ...(project.tracks ?? []).map(t => t.name),
          ...(project.arrangementClips ?? []).map(c => c.name),
        ].filter(Boolean) as string[]
        rememberCommand(text, ranCalls, names)

        // ── And offer it to everybody else ────────────────────────────────
        //
        // ⚠️ ONLY THE GENERALISED FORM, and only when every literal word left
        // in it is one the studio already knows — see shareable(). The slots
        // take out the names; that check takes out everything else, so what
        // travels is a phrasing and a tool call and nothing a person said
        // about their own song.
        //
        // Fire and forget, on purpose. Contributing is a gift, and a failed
        // gift must never look like a failed command.
        const gift = shareableTemplate(text, ranCalls, names)
        if (gift) {
          void fetch('/api/voice/learned', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(gift),
          }).catch(() => { /* nobody needs to know */ })
        }
      }
      history.current = [
        ...history.current,
        { role: 'user' as const, content: text },
        ...(lastSay || spoke ? [{ role: 'assistant' as const, content: lastSay || spoke }] : []),
      ].slice(-6)
      setAsking('')
      if (spoke && lastSay) respond(spoke)
      // A refusal was spoken above, with the model's own words folded in —
      // putting them in the answer line as well would show them twice.
      setSaid(lastSay || (lastProblem ? '' : spoke))
      traceEnd(lastSay || spoke, lastProblem)
    } catch (err) {
      const timedOut = (err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError'
      // ⚠️ THE RULES ARE THE SAFETY NET, even though they no longer go first.
      // Standing back from the assistant must not mean a studio that does
      // nothing when the assistant cannot be reached — before this, "mute the
      // drums" would simply have failed on a bad connection, which is a much
      // worse experience than the rule being occasionally wrong.
      //
      // It SAYS it used its own reading, because the answer may differ from
      // what the assistant would have done and silently substituting one for
      // the other is how somebody stops trusting either.
      if (confidentEnough(local, heardConfidence) && !local.destructive) {
        const plan = planVoiceCalls(local.calls, project, voiceCtx())
        if (!plan.problem && plan.actions.length) {
          for (const a of plan.actions) runAction(a)
          lastAcceptedAt.current = Date.now()
          respond(`${plan.say} (the assistant is unreachable, so I used what I understood myself.)`)
          markFailed(timedOut ? 'assistant timeout' : 'assistant unreachable')
          postExchange({ said: text, calls: local.calls, say: plan.say, path: 'rules',
            outcome: `assistant ${timedOut ? 'timed out' : 'unreachable'}; the rules answered instead` })
          setBusy(false)
          return
        }
      }
      setProblem(timedOut
        ? 'The assistant took too long. Say it again — it usually comes back.'
        : 'Couldn\'t reach the assistant.')
      markFailed(timedOut ? 'assistant timeout' : 'assistant unreachable')
      postExchange({ said: text, path: 'failed', outcome: timedOut ? 'assistant timed out' : 'assistant unreachable' })
    } finally {
      setBusy(false)
    }
    // The conversation states are dependencies, not incidental reads. Without
    // them this closure captures the question as it was when the callback was
    // built — which is null — so the answer to a question the studio had just
    // asked was parsed as a fresh command and did nothing at all.
    // `queue` is a dependency, not an incidental read: without it this closure
    // holds the list as it was when the callback was built — which is empty —
    // so "execute" reported nothing collected and then cleared the list it
    // could not see. runQueue is reached through a ref because it is declared
    // below, the same way finish() is.
    // pendingAsk is a dependency for the same reason the others are, and the
    // symptom would have been the same one this file has produced three times:
    // the closure holds the question as it was when it was built — null — so
    // "yes" is parsed as a fresh command and confirms nothing.
  }, [inStudio, project, runAction, pendingAsk, pendingAsk2, pendingOffer, pendingName, respond,
    undo, redo, selectedTrackId, selectedClipId, queue])

  // Does the user still want to be listening? Asking for the microphone is
  // asynchronous and the first ask shows a dialog, so in hold-to-talk the
  // button can easily be released before permission resolves. Without this the
  // recognition would start after the release and never be stopped — the
  // microphone stays open with nothing watching it.
  const wanted = useRef(false)

  /** A finished sentence, from either transcriber. Same treatment either way:
   *  choose among alternatives using the project's real names, repair them,
   *  then run it. */
  const heardSentence = useCallback((
    text: string,
    alternatives: string[][],
    confidence: number,
    // Carries the TIMES too. A spoken beat is nothing but the times, and
    // narrowing them away here is exactly how they would go missing between
    // the transcriber that reports them and the planner that needs them.
    words?: { word: string; confidence: number; s?: number; e?: number }[],
  ) => {
    // A continuous session is still listening: the sentence ended, the take did
    // not. Clearing it here made the button claim to be off while the
    // microphone was open, which is the one thing a microphone indicator must
    // never get wrong.
    if (!continuousRef.current) setListening(false)
    // A new sentence, a fresh account of what it did.
    didRef.current = []
    // ── Its own voice, heard back ──────────────────────────────────────────
    //
    // The record, 22:03–22:05: "Restart." ×3, "Pause." ×5. The read-back was
    // the command word, the room played it back into the microphone, and the
    // rules ran it again. The read-backs no longer use command words, and this
    // is the second guard: within a few seconds of Light speaking, a transcript
    // that is what it just said (or a piece of it) is its own echo, not you.
    {
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
      const heardN = norm(text), spokeN = norm(lastSpokenRef.current)
      const recent = Date.now() - lastReplyAt.current < 8000
      if (recent && heardN.length >= 4 && spokeN.length >= 4 && (spokeN.includes(heardN) || heardN.includes(spokeN))) {
        console.info('[voice] ignored an echo of the read-back:', text)
        return
      }
    }
    // hearBetter repairs the project's own nouns — "base two" into "Bass 2" —
    // which is the single most valuable correction available, because a general
    // recogniser has never seen these names and mangles them constantly.
    //
    // But it used to REPLACE the transcript, and a correction that replaces its
    // own evidence cannot be checked against anything afterwards. So it is
    // demoted to a candidate: it competes with the words actually heard, and
    // wins on the merits when it fits the project better.
    const repaired = alternatives.length
      ? alternatives.map(a => hearBetter(a, project.tracks ?? [])).join(' ')
      : hearBetter([text], project.tracks ?? [])
    const heard: Heard = {
      text: text || repaired,
      alternatives: [repaired, ...alternatives.flat()].filter(Boolean),
      words,
      confidence,
    }
    setHeard(repaired || text)
    void run(heard.text, confidence, false, heard)
  }, [project, run])

  /** Record and transcribe on the server — the path that does not go through
   *  the browser's speech service. */
  const startRecorded = useCallback(async () => {
    setProblem('Listening…')
    // Decided once, here, and read by callbacks that outlive this render.
    // Toggling the setting mid-session must not change what the take already
    // running is doing.
    continuousRef.current = modeRef.current === 'toggle'
    // Pressing the button IS addressing it, so a session opens attentive and
    // the first command needs no name. It goes quiet on its own after that.
    lastAcceptedAt.current = Date.now()
    // Hand the transcriber the words that are actually likely here — the
    // commands it can act on, and the names of the tracks in this project.
    // ── In the order the hints matter ────────────────────────────────────────
    //
    // Any cap cuts the tail, so the tail must be the least valuable part.
    //
    // NAMES FIRST. A recogniser has never seen this project and cannot guess
    // "Bass 2" or "Body 1" from anything; every other word here it has at least
    // met before.
    //
    // THEN THE NAME IT ANSWERS TO, which is load-bearing — a session that
    // cannot hear "light" over a mix never wakes up.
    //
    // THEN PHRASES, because "low pass" as a unit is unmistakable where "low"
    // and "pass" apart are two of the commonest words in English.
    const named = [
      ...(project.tracks ?? []).map(t => t.name),
      ...(project.arrangementClips ?? []).map(c => c.name),
    ].filter((n): n is string => !!n && n.trim().length > 1)
    const vocabulary = [...new Set([
      ...named,
      ...WAKE_WORDS,
      ...COMMAND_VOCABULARY.filter(t => t.includes(' ')),
      ...COMMAND_VOCABULARY.filter(t => !t.includes(' ')),
    ])]
    const rec = await startRecording({
      vocabulary,
      // ⚠️ The click is the signal that a BEAT might be coming.
      //
      // Brae: "the metronome will allows users to sing a beat into the
      // transcription system." Somebody with the click running and the
      // microphone open is very likely saying a rhythm, and the recogniser is
      // normally told to throw away exactly the syllables a rhythm is made of.
      // Turning the click on is the clearest statement of intent available
      // without adding a mode nobody asked for.
      beat: metronomeOnRef.current,
      // Both of these change how the microphone is opened, and both are things
      // only the studio knows: whether the monitor path must be left alone, and
      // what rate it is running at.
      playing: !!engine?.isPlaying,
      sampleRate: engine?.ctx?.sampleRate,
      // Borrow the studio's own context rather than opening a second one on the
      // same hardware. Two clients negotiating one audio device is where the
      // crackle comes from, and a held-open session gives it minutes to happen.
      audioContext: engine?.ctx,
      // Brae: "This way the user can do multiple things while only clicking
      // Voice once." Only in toggle mode — holding a button to talk already
      // says when you are finished, and holding it for a session would be an
      // odd way to ask for one.
      continuous: continuousRef.current,
      sensitivity: sensitivityRef.current,
      patience: patienceRef.current,
      onUtterance: r => handleTake(r),
      // A live meter, because "is it even hearing me" is the first question
      // when this goes wrong and it should not need asking twice.
      onLevel: (l, bar) => {
        // ⚠️ NOT EVERY TICK. The meter reports every 50 ms, and each report
        // used to set two states — re-rendering this whole control, the card,
        // and whatever bar sat beside it (a 200-row transcript, the settings)
        // twenty times a second, for the entire session. The cost grew with
        // the transcript and the logs, the main thread got busier, and the
        // recorder, the VAD and the transcription fetch all queued behind it:
        // Brae: "Light was slower to transcribe what I was saying the longer
        // it ran." Twelve visible updates a second is the same meter; the
        // values in between move nothing anybody can see.
        const now = Date.now()
        if (now - levelPaintedAt.current >= 80 || Math.abs(l - levelPainted.current) > 0.25) {
          levelPaintedAt.current = now
          levelPainted.current = l
          setLevel(l); setThreshold(bar)
        }
        // Above the bar means somebody is talking; the reply's voice waits.
        if (l > bar) userSpeakingUntil.current = now + 700
      },
      onSpeechStart: () => { setProblem(''); userSpeakingUntil.current = Date.now() + 700 },
      // It ends itself once talking stops, so the trailing room does not get
      // recorded. finish() is what turns the take into a command.
      // Through a ref: finish() is defined below this callback, and the take
      // can end itself at any moment, so capturing it directly would either
      // read a stale closure or force an ordering that has nothing to do with
      // how the code is best read.
      onSilence: () => { finishRef.current?.() },
    })
    if (!rec) { setProblem(micProblemMessage()); return }
    setMic(rec.mic)
    if (rec.mic.degraded) {
      // Not our doing, and not fixable from a browser: a headset that carries
      // both the microphone and the monitoring switches itself into a
      // hands-free profile when an input opens, and everything it plays drops
      // to a narrow, grainy 16 kHz. Saying so is the only useful thing
      // available, and it beats leaving somebody to conclude the studio is
      // broken.
      setProblem(`${rec.mic.label || 'That device'} switched to call quality (${rec.mic.sampleRate} Hz) — monitor on something else while voice is on.`)
    }
    if (!wanted.current) { rec.cancel(); setProblem(''); return }
    recorder.current = rec
    setProblem('')
    // Stop talking the instant the microphone opens, or it transcribes
    // itself — and "Bass 2 muted" reads as a plausible command.
    stopSpeaking()
    setListening(true)
    // Brae: "create a windowed panel that opens when voice control is
    // activated". Opened here rather than on the click, so it appears when the
    // microphone is genuinely live rather than while permission is pending.
    setPanelOpen(true)
    // `engine` matters here now: whether the transport is running decides how
    // the microphone is opened, and a stale engine would decide it wrongly.
  }, [project, engine])

  const start = useCallback(async () => {
    if (listening || busy) return
    wanted.current = true
    setHeard(''); setSaid(''); setProblem('')
    // Ask for the microphone BEFORE starting recognition. Relying on
    // SpeechRecognition to raise its own prompt left the button doing nothing
    // at all on a machine that had never granted access — see requestMic().
    // Said out loud here, because a permission dialog appearing with no
    // explanation is its own kind of broken.
    setProblem('Waiting for microphone permission…')
    const mic = await requestMic()
    if (!wanted.current) { setProblem(''); return }
    if (!mic.ok) { setProblem(mic.message ?? 'No microphone.'); return }
    setProblem('')

    // ── Which ear to use ─────────────────────────────────────────────────────
    //
    // The browser's recogniser is preferred: it is instant, free, and shows the
    // words as they are spoken. But it streams audio to Google, and on a
    // machine that cannot reach that service it never works — so once that has
    // been established, stop trying it and record instead. Rediscovering the
    // failure on every command, twelve retries at a time, is its own kind of
    // broken.
    if (preferredTranscriber() === 'server' || !available.current) {
      await startRecorded()
      return
    }

    const h = listen({
      // An interim transcript means the words are still coming — hold the
      // voice, and count it as speech for the "didn't catch that" gate.
      onPartial: t => { setHeard(t); if (t) userSpeakingUntil.current = Date.now() + 900 },
      onFinal: heardSentence,
      onError: m => {
        setListening(false)
        // The browser told us it cannot reach its speech service. Switch to
        // recording permanently on this browser and say so once — the next
        // command will simply work rather than failing the same way again.
        if (/speech service/i.test(m)) {
          setPreferredTranscriber('server')
          // Carry straight on rather than saying "try again". The button was
          // pressed because there was something to say, and making someone
          // press it twice to work around a fault they did not cause is a poor
          // apology. Only while they are still holding it — a release during
          // the failed attempt means they have given up on this one.
          if (wanted.current) {
            setProblem('Switched to recording — go ahead.')
            void startRecorded()
          } else {
            setProblem('Your browser can\'t reach its speech service — switched to recording.')
          }
          return
        }
        setProblem(m)
        // A failure that names typing as the way forward should OPEN the box,
        // not just mention it. Being told what to do instead and then having to
        // find it is its own small failure.
        if (/type the command/i.test(m)) setShowType(true)
      },
    })
    if (!h) return
    handle.current = h
    // Released while the recognition was being built: stop it immediately
    // rather than leaving it open.
    if (!wanted.current) { h.abort(); handle.current = null; return }
    // Stop talking the instant the microphone opens, or it transcribes
    // itself — and "Bass 2 muted" reads as a plausible command.
    stopSpeaking()
    setListening(true)
  }, [listening, busy, run])

  /**
   * Answer the pending question by clicking.
   *
   * Deliberately routed through run() with the option's own words rather than
   * acting directly: one path means the click and the sentence cannot drift
   * apart, and the spoken path — the one that is hard to get right — is
   * exercised every time anybody uses the buttons.
   */
  const answerByHand = useCallback((words: string) => {
    void run(words, 1)
  }, [run])



  /**
   * What to do with a finished take.
   *
   * Shared by the one-shot path and the continuous one, because they differ in
   * exactly one thing — whether the microphone closes afterwards — and every
   * other difference between them would be a bug.
   */
  const handleTake = useCallback((r: StopResult) => {
    // A server fault is not the speaker's fault. "I didn't catch that" is
    // only correct when the recording genuinely held no words.
    if (!r.ok) { setProblem(r.error); markFailed(r.error); return }
    if (!r.result || !r.result.text) {
      // An empty take while something is still being worked on, held, or
      // spoken is the pause around a command, not a command that failed.
      const midway = busyRef.current || !!heldFragment.current
        || Date.now() - lastAcceptedAt.current < 4000 || Date.now() < userSpeakingUntil.current + 2500
      if (!midway) setProblem('I didn\'t catch that.')
      return
    }
    const { text, alternatives, confidence, words } = r.result
    // Per-word confidence is the most useful thing in the response: it says
    // WHICH word the recogniser struggled with, so only that word needs
    // reconsidering and the rest can be taken at face value.
    heardSentence(text, alternatives.length ? [alternatives] : [], confidence, words)
  }, [heardSentence, markFailed])

  /**
   * Carry out everything collected, in the order it was said.
   *
   * Re-planned rather than replayed: a command was resolved against the project
   * as it was when it was collected, and the project may have moved since —
   * including because an earlier command in this same batch moved it.
   */
  const runQueue = useCallback(() => {
    const items = queue
    setQueue([])
    offeredAt.current = 0
    if (!items.length) { respond('Nothing collected yet.'); return }
    let done = 0
    const failed: string[] = []
    for (const item of items) {
      const plan = planVoiceCalls(item.calls, project, voiceCtx())
      if (plan.problem) { failed.push(plan.problem); continue }
      for (const a of plan.actions) runAction(a)
      done++
    }
    respond(reportRun(done, failed))
  }, [queue, project, runAction, respond])

  useEffect(() => { runQueueRef.current = runQueue }, [runQueue])

  /**
   * Measure the room, then the voice, then say which of them is the problem.
   *
   * Runs its own recording rather than borrowing the session's, so it can be
   * done before ever starting one — somebody whose first attempt produced
   * nonsense should not have to get a session working in order to find out why
   * it will not.
   */
  const calibrate = useCallback(async () => {
    if (calibrating) return
    setCalibration(null)
    setCalibrating('room')

    let floor = 0
    let samples = 0
    let peak = 0
    let phase: 'room' | 'voice' = 'room'

    const rec = await startRecording({
      vocabulary: [...WAKE_WORDS, ...COMMAND_VOCABULARY],
      playing: !!engine?.isPlaying,
      sampleRate: engine?.ctx?.sampleRate,
      audioContext: engine?.ctx,
      // Deliberately NOT continuous: this is one take of a known phrase, and
      // the strictness that suits a held-open microphone would measure the
      // wrong thing.
      onLevel: level => {
        setLevel(level)
        // Two seconds of room first, whatever is in it, then whatever is said.
        if (phase === 'room') { floor = (floor * samples + level) / (samples + 1); samples++ }
        else if (level > peak) peak = level
      },
    })
    if (!rec) {
      setCalibrating(null)
      setProblem(micProblemMessage())
      return
    }

    await new Promise(r => setTimeout(r, 2000))
    phase = 'voice'
    setCalibrating('voice')
    // Long enough to read the phrase without hurrying.
    await new Promise(r => setTimeout(r, 6000))

    const out = await rec.stop()
    setLevel(0)
    setCalibrating(null)

    const heard = out.ok ? (out.result?.text ?? '') : ''
    const confidence = out.ok ? (out.result?.confidence ?? 0) : 0
    const accuracy = phraseAccuracy(CALIBRATION_PHRASE, heard)
    const { verdict, suggested } = verdictFor({
      floor, peak, accuracy, confidence,
      sampleRate: rec.mic.sampleRate, micLabel: rec.mic.label,
    })
    setCalibration({
      floor, peak, headroom: floor > 0 ? peak / floor : 0,
      heard: out.ok ? heard : (out.error || 'nothing came back'),
      accuracy, confidence,
      micLabel: rec.mic.label, sampleRate: rec.mic.sampleRate,
      suggested, verdict,
    })
    // Measured, so applied. Leaving somebody to copy a number from a report
    // into a setting is asking them to do the last step by hand for no reason.
    setSensitivityState(suggested)
    sensitivityRef.current = suggested
    setVoiceSensitivity(suggested)
  }, [calibrating, engine])

  const finish = useCallback(() => {
    wanted.current = false
    setLevel(0)
    if (recorder.current) {
      const rec = recorder.current
      recorder.current = null
      setListening(false)
      setBusy(true)
      const wasContinuous = continuousRef.current
      continuousRef.current = false
      void rec.stop().then(r => {
        setBusy(false)
        // Nothing left to transcribe when the session was continuous: every
        // utterance was already handled as it happened, and the final stop is
        // just the microphone closing.
        if (r.ok && !r.result && wasContinuous) return
        handleTake(r)
      })
      return
    }
    handle.current?.stop()
    handle.current = null
    setListening(false)
    continuousRef.current = false
  }, [heardSentence])

  /**
   * The global shortcut, and the menu bar, reaching Light.
   *
   * ⚠️ A TOGGLE, because that is what the platform can actually do. Electron's
   * globalShortcut fires on key DOWN and reports nothing on release, so a
   * hold-to-talk key cannot be built on it. Calling it push-to-talk and having
   * it latch is a small lie somebody discovers mid-sentence, so it presses to
   * start and presses again to stop.
   *
   * Works while 100Lights is not the focused app, which is the whole point:
   * the studio is behind a browser window and you want to say something to it.
   */
  useEffect(() => {
    const onMenu = (e: Event) => {
      if ((e as CustomEvent<{ command: string }>).detail?.command !== 'voice-toggle') return
      if (listening) finish()
      else void start()
    }
    window.addEventListener('100lights:menu', onMenu)
    return () => window.removeEventListener('100lights:menu', onMenu)
  }, [listening, start, finish])

  // The recorder can finish a take on its own when talking stops; keep the ref
  // pointing at the current handler so it never calls a stale one.
  useEffect(() => { finishRef.current = finish }, [finish])

  /**
   * Offer to carry the list out once the talking stops.
   *
   * Brae: "This will be prompted by the machine by having it ask 'Do you want to
   * implement these changes?'"
   *
   * After a pause rather than after a count, because the natural end of a batch
   * is when somebody stops describing it. Offered ONCE per batch — an assistant
   * that asks the same question every few seconds is one people answer by
   * turning it off.
   */
  useEffect(() => {
    if (!collecting || !queue.length) return
    const id = setInterval(() => {
      if (!queue.length) return
      if (offeredAt.current >= lastQueuedAt.current) return
      if (Date.now() - lastQueuedAt.current < 6000) return
      offeredAt.current = Date.now()
      respond(askToImplement(queue), 'question')
    }, 1500)
    return () => clearInterval(id)
  }, [collecting, queue, respond])

  // Enter runs the command — but only when Enter is not doing something else.
  // A DAW binds Enter (rename a track, confirm a field), and stealing it would
  // break editing to serve a feature nobody has invoked yet. So it only counts
  // while nothing is focused and the setting is on.
  useEffect(() => {
    if (!enterRuns) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
      const el = document.activeElement as HTMLElement | null
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
        || el.getAttribute('role') === 'textbox')
      if (typing) return
      if (listening) { e.preventDefault(); finish() }
      else if (!busy) { e.preventDefault(); void start() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enterRuns, listening, busy, start, finish])

  const label = busy ? 'Working…' : listening ? 'Listening…' : 'Voice'
  const active = listening || busy

  const hold = mode === 'hold'
  const press = hold
    ? { onPointerDown: () => void start(), onPointerUp: finish, onPointerLeave: finish }
    : { onClick: () => { if (listening) finish(); else void start() } }

  /**
   * Everything the studio is waiting on an answer to.
   *
   * Brae: "Questions and answers should also live in the voice control window.
   * Things like 'I didn't catch that' and questions about what was said should
   * live there. That means that they shouldn't be in other places, since the
   * space around the voice control gets crowded."
   *
   * ⚠️ These were five separate popovers anchored to the BUTTON, each with its
   * own corner and its own z-index, and the read-back bubble made six. They
   * argued with each other and with the window: an earlier fix here had to stop
   * a question and an "I didn't get that" appearing together, and another had to
   * re-anchor questions so opening the panel did not hide the very thing you
   * were being asked. Both were the same problem — several surfaces competing
   * for one corner — and one home is the fix rather than better rules about
   * which corner each gets.
   *
   * The order is the order they take precedence in, and only one is ever set.
   */
  const qCard: React.CSSProperties = {
    padding: 11, background: '#141414', border: `1px solid ${C.accent}`,
    borderRadius: 8, fontSize: 12, color: C.textPrimary,
  }
  const question = (pendingAsk2 || pendingOffer || pendingName || pendingDo || choices
    || pendingAsk !== null || asking)
    ? (
      <>
        {(pendingAsk2 || pendingOffer || pendingName) && (
          <div
            style={{
              ...qCard,
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ color: C.accent, fontSize: 9, fontWeight: 800, letterSpacing: 0.5, marginBottom: 5 }}>
              {pendingName ? 'WHAT SHOULD IT BE CALLED?' : 'WHICH DID YOU MEAN?'}
            </div>
            <div style={{ marginBottom: 8, lineHeight: 1.4 }}>
              {pendingAsk2?.speak ?? pendingOffer?.speak ?? pendingName?.prompt}
            </div>

            {/* Every question is answerable by clicking as well as by speaking.
                The spoken path is the point of the feature; the clicks are what
                make it usable with speech off, on a machine with no voices, or in
                a room where talking is not an option. */}
            {pendingAsk2 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {pendingAsk2.options.map((option, i) => (
                  <button
                    key={i}
                    // A closure option is picked directly. Routing it through
                    // answerByHand would send the label back through keyword
                    // matching, which is the long way round to the same button
                    // and fails whenever two labels share a word.
                    onClick={() => {
                      if (!option.onPick) { answerByHand(option.label); return }
                      setPendingAsk2(null)
                      option.onPick()
                    }}
                    style={choiceStyle(i === 0)}
                    onMouseEnter={e => choiceHover(e, true)}
                    onMouseLeave={e => choiceHover(e, i === 0)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}

            {pendingOffer && (
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => answerByHand('yes')}
                  style={{
                    flex: 1, height: 26, borderRadius: 4, cursor: 'pointer',
                    border: `1px solid ${C.accent}`, background: `${C.accent}22`, color: C.accent,
                    fontSize: 10, fontWeight: 800, letterSpacing: 0.3,
                  }}
                >
                  YES
                </button>
                <button
                  onClick={() => answerByHand('no')}
                  style={{
                    height: 26, padding: '0 12px', borderRadius: 4, cursor: 'pointer',
                    border: `1px solid ${C.border}`, background: 'transparent', color: C.textMuted,
                    fontSize: 10, fontWeight: 800, letterSpacing: 0.3,
                  }}
                >
                  NO
                </button>
              </div>
            )}

            {pendingName && (
              <input
                autoFocus
                placeholder="a new name…"
                onKeyDown={e => {
                  e.stopPropagation()
                  const value = (e.target as HTMLInputElement).value.trim()
                  if (e.key === 'Enter' && value) answerByHand(value)
                  if (e.key === 'Escape') { setPendingName(null); setSaid('Left as it is.') }
                }}
                style={{
                  width: '100%', height: 26, padding: '0 8px', boxSizing: 'border-box',
                  background: '#141414', border: `1px solid ${C.border}`, borderRadius: 4,
                  color: C.textPrimary, fontSize: 11, outline: 'none',
                }}
              />
            )}

            <div style={{ color: C.textMuted, fontSize: 10, marginTop: 6 }}>
              {pendingName ? 'Or say it.' : 'Or answer out loud.'}
            </div>
          </div>
        )}

        {pendingDo && (
          <div
            style={{
              ...qCard,
              borderColor: '#b4453a',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ color: '#e0776b', fontSize: 9, fontWeight: 800, letterSpacing: 0.5, marginBottom: 5 }}>
              THIS CANNOT BE UNDONE BY SAYING THE OPPOSITE
            </div>
            <div style={{ marginBottom: 8, lineHeight: 1.4 }}>{pendingDo.label}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => {
                  const plan = planVoiceCalls(pendingDo.calls, project, voiceCtx())
                  setPendingDo(null)
                  if (plan.problem) { setProblem(plan.problem); return }
                  for (const a of plan.actions) runAction(a)
                  setSaid(plan.say)
                }}
                style={{
                  flex: 1, height: 26, borderRadius: 4, cursor: 'pointer',
                  border: '1px solid #b4453a', background: 'rgba(180,69,58,.16)', color: '#e0776b',
                  fontSize: 10, fontWeight: 800, letterSpacing: 0.3,
                }}
              >
                DO IT
              </button>
              <button
                onClick={() => setPendingDo(null)}
                style={{
                  height: 26, padding: '0 10px', borderRadius: 4, cursor: 'pointer',
                  border: `1px solid ${C.border}`, background: 'transparent', color: C.textMuted,
                  fontSize: 10, fontWeight: 800, letterSpacing: 0.3,
                }}
              >
                CANCEL
              </button>
            </div>
          </div>
        )}

        {choices && (
          <div
            style={{
              ...qCard,
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ color: C.textMuted, fontSize: 9, fontWeight: 800, letterSpacing: 0.5, marginBottom: 6 }}>
              WHICH DID YOU MEAN?
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {choices.map((choice, i) => (
                <button
                  key={i}
                  onClick={() => {
                    const plan = planVoiceCalls(choice.calls, project, voiceCtx())
                    setChoices(null)
                    if (plan.problem) { setProblem(plan.problem); return }
                    for (const a of plan.actions) runAction(a)
                    setSaid(plan.say)
                  }}
                  style={choiceStyle(i === 0)}
                  onMouseEnter={e => choiceHover(e, true)}
                  onMouseLeave={e => choiceHover(e, i === 0)}
                >
                  {choice.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setChoices(null)}
              style={{
                marginTop: 7, height: 22, padding: '0 9px', borderRadius: 4, cursor: 'pointer',
                border: `1px solid ${C.border}`, background: 'transparent', color: C.textMuted,
                fontSize: 10, fontWeight: 700,
              }}
            >
              NEITHER
            </button>
          </div>
        )}

        {pendingAsk !== null && (
          <div
            style={{
              ...qCard,
              border: `1px solid ${C.accent}`, borderRadius: 6,
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ color: C.textMuted, fontSize: 9, fontWeight: 800, letterSpacing: 0.5, marginBottom: 5 }}>
              I DON&apos;T KNOW THAT ONE — HEARD:
            </div>
            {/* Editable, because the thing being guarded against is a MISHEARING.
                Reading it back is what catches one; being able to correct it is
                what makes the catch useful. A corrected sentence is re-tried
                locally first, so fixing a misheard word usually costs nothing. */}
            <input
              autoFocus
              value={pendingAsk}
              onChange={e => setPendingAsk(e.target.value)}
              onKeyDown={e => {
                e.stopPropagation()
                if (e.key === 'Enter') { const t = pendingAsk.trim(); setPendingAsk(null); if (t) void run(t, 1, true) }
                if (e.key === 'Escape') setPendingAsk(null)
              }}
              style={{
                width: '100%', height: 26, padding: '0 8px', boxSizing: 'border-box',
                background: '#141414', border: `1px solid ${C.border}`, borderRadius: 4,
                color: C.textPrimary, fontSize: 11, outline: 'none', marginBottom: 8,
              }}
            />
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => { const t = pendingAsk.trim(); setPendingAsk(null); if (t) void run(t, 1, true) }}
                style={{
                  flex: 1, height: 26, borderRadius: 4, cursor: 'pointer',
                  border: `1px solid ${C.accent}`, background: `${C.accent}22`, color: C.accent,
                  fontSize: 10, fontWeight: 800, letterSpacing: 0.3,
                }}
              >
                ASK THE ASSISTANT
              </button>
              <button
                onClick={() => setPendingAsk(null)}
                style={{
                  height: 26, padding: '0 10px', borderRadius: 4, cursor: 'pointer',
                  border: `1px solid ${C.border}`, background: 'transparent', color: C.textMuted,
                  fontSize: 10, fontWeight: 800, letterSpacing: 0.3,
                }}
              >
                CANCEL
              </button>
            </div>
            <div style={{ color: C.textMuted, fontSize: 10, marginTop: 6 }}>
              Uses {LUMENS_NAME}. Fix the words above and press Enter to try again for free.
            </div>
          </div>
        )}

        {asking && (
          <div
            style={{
              ...qCard,
              lineHeight: 1.45,
            }}
          >
            <div style={{ color: C.accent, fontSize: 9, fontWeight: 800, letterSpacing: 0.5, marginBottom: 3 }}>
              ASKING
            </div>
            {asking}
            <div style={{ color: C.textMuted, marginTop: 5, fontSize: 10 }}>
              Answer below, or hold the mic and say it.
            </div>
          </div>
        )}
      </>
    )
    : null

  // ⚠️ A question now lives ONLY in the window, so the window has to be open
  // for one to be readable at all. Opening it is also the honest signal: the
  // studio has stopped and is waiting on you, which is exactly when you want
  // the thing you are talking to in front of you.
  //
  // Not on `heard`: that fires on every syllable, and a panel that opens
  // because somebody started talking is a panel nobody can keep closed.
  // ⚠️ Brae: "the voice control panel has moments where it won't allow me to
  // close it."
  //
  // `question` is a JSX FRAGMENT, built fresh on every render — so as a
  // dependency it has always changed, this effect ran on every render, and any
  // render at all while a question or a read-back was on screen re-opened the
  // panel the instant it was closed. Nothing was wrong with the close button;
  // it was being undone a frame later.
  //
  // The fix is to depend on WHETHER there is a question, not on the markup that
  // shows it. Now the panel opens when one arrives and stays shut once shut,
  // until something new actually happens.
  const hasQuestion = !!(pendingAsk2 || pendingOffer || pendingName || pendingDo
    || choices || pendingAsk !== null || asking)
  useEffect(() => {
    if (hasQuestion || problem || said) setPanelOpen(true)
  }, [hasQuestion, problem, said])

  return (
    <div ref={anchorRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', ...style }}>
      <button
        {...press}
        data-voice-control
        aria-pressed={listening}
        title={hold
          ? 'Hold to speak a command — "loop bass 2 three more times"'
          : 'Click to start speaking, click again to run'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          height: 22, padding: '0 9px', borderRadius: 5,
          border: `1px solid ${active ? C.accent : C.border}`,
          background: listening ? `${C.accent}33` : active ? `${C.accent}22` : 'transparent',
          color: active ? C.accent : C.textMuted,
          fontSize: 10, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase',
          cursor: busy ? 'default' : 'pointer',
        }}
      >
        {busy ? <Loader2 size={12} className="spin" /> : <Mic size={12} />}
        {label}
        {/* A live level meter while recording.
            "Is it even hearing me" is the first question when voice goes wrong,
            and until now the only answer was to speak and wait. A bar that
            moves with your voice answers it before the command is finished —
            and if it stays flat, the problem is the microphone rather than
            anything downstream. */}
        {listening && (
          <span
            aria-hidden
            style={{
              width: 22, height: 4, borderRadius: 2, marginLeft: 2,
              background: `${C.accent}33`, overflow: 'hidden', display: 'inline-block',
            }}
          >
            <span style={{
              display: 'block', height: '100%', borderRadius: 2, background: C.accent,
              width: `${Math.round(Math.min(1, level) * 100)}%`,
              transition: 'width 80ms linear',
            }} />
          </span>
        )}
      </button>

      {/* Type instead. Always available — not only after something has failed,
          because a typed command is often simply faster, and because a control
          that appears only in an error state is one nobody knows exists. */}
      <button
        onClick={e => { e.stopPropagation(); setShowType(v => !v); setProblem('') }}
        title="Type a command instead of speaking"
        style={{
          marginLeft: 4, height: 22, padding: '0 7px', borderRadius: 5,
          border: `1px solid ${showType ? C.accent : C.border}`,
          background: showType ? `${C.accent}22` : 'transparent',
          color: showType ? C.accent : C.textMuted,
          fontSize: 10, fontWeight: 800, letterSpacing: 0.4, cursor: 'pointer',
        }}
      >
        TYPE
      </button>

      <button
        onClick={e => {
          e.stopPropagation()
          // Settings live in the panel now. Two places rendering the same
          // controls is how the two of them end up disagreeing about what the
          // setting currently is. They open in the bar beside the card.
          if (panelOpen && side === 'settings') { setSide('none'); return }
          setSide('settings')
          setPanelOpen(true)
        }}
        data-voice-settings
        aria-label="Voice settings"
        title="How the voice button works"
        style={{
          marginLeft: 2, display: 'inline-flex', alignItems: 'center', height: 22,
          padding: '0 4px', border: 'none', background: 'transparent',
          color: C.textMuted, cursor: 'pointer',
        }}
      ><Settings2 size={11} /></button>

      {caption && (
        <VoiceCaption
          saying={spokenRaw || heard}
          reply={said}
          problem={problem}
          listening={listening}
        />
      )}

      {/* ⚠️ HUD MODE IS A DIFFERENT SURFACE, not the panel with things hidden.
          Brae: "a full voice control UI that shows the program without any
          buttons, just information and visuals... The only buttons will be to
          return to normal hud, type commands, and exit voice control."

          Every control stays in the panel; this shows state, the conversation,
          what the assistant can SEE of the song, and the last few commands. It
          renders only while HUD mode is on, so it costs nothing otherwise. */}
      {hud && (
        <VoiceHud
          listening={listening}
          continuous={continuousRef.current}
          level={level}
          talking={talking}
          hearing={taking || heard}
          said={said}
          question={asking || pendingAsk2?.speak || ''}
          problem={problem}
          recent={recentContext(4).split('\n').filter(Boolean)}
          facts={[
            { label: 'Tempo', value: `${Math.round(project.tempo || 120)} BPM` },
            { label: 'Tracks', value: String(project.tracks?.length ?? 0) },
            ...(() => {
              const t = project.tracks?.find(x => x.id === selectedTrackId)
              return t ? [{ label: 'Selected', value: t.name }] : []
            })(),
            { label: 'Assistant', value: assistantMode() === 'rules' ? 'off' : aiAutoRef.current ? 'acting' : 'asks first' },
          ]}
          onNormalHud={() => { setHudState(false); setHud(false) }}
          onType={() => setShowType(true)}
          onExit={() => { setHudState(false); setHud(false); setListening(false); setPanelOpen(false) }}
          colors={{
            bg: C.bgSurface, surface: C.bgSurface, border: C.border,
            text: C.textPrimary, muted: C.textMuted, accent: C.accent,
          }}
        />
      )}

      {panelAnim.mounted && (
        <VoicePanel
          placement={panelDir}
          animClass={popClass(panelDir, panelAnim.leaving)}
          listening={listening}
          continuous={continuousRef.current}
          level={level}
          // The live view: what is being said now, what came back, and whether
          // the studio itself is talking (which the wave needs and no level can
          // report, since the microphone is deafened while it speaks).
          talking={talking}
          saying={heard}
          // ⚠️ During a take the status IS the message that matters: "Counting
          // in…" then "Say it…" is the difference between speaking on the beat
          // and speaking into a microphone that has not opened yet. It wins the
          // slot for as long as the take is running.
          reply={taking || said}
          problem={problem}
          question={question}
          hud={hud}
          side={side}
          onSide={setSide}
          // – hides the card and keeps listening; ✕ is the voice button pressed
          // off. Brae: "The x button will turn off voice controls as if the
          // voice control button was pressed to toggle off."
          onMinimize={() => setPanelOpen(false)}
          mode={mode}
          onMode={m => { setMode(m); modeRef.current = m; writeVoiceMode(m) }}
          enterRuns={enterRuns}
          onEnterRuns={on => { setEnterRuns(on); writeVoiceEnter(on) }}
          speaks={speaks}
          onSpeaks={on => { setSpeaks(on); setSpeechEnabled(on) }}
          canSpeak={speechAvailable()}
          studio={studio}
          onStudio={on => { setStudio(on); setStudioVoice(on) }}
          onHud={on => { setHudState(on); setHud(on) }}
          mic={mic}
          threshold={threshold}
          assistant={assist}
          onAssistant={m => {
            setAssistState(m)
            assistRef.current = m
            setAssistantMode(m)
            // The barrier reads the older flag, so both move together rather
            // than the two disagreeing about whether to stop and ask.
            const auto = m === 'auto'
            setAiAutoState(auto)
            aiAutoRef.current = auto
          }}
          ear={ear}
          onEar={e => { setEarState(e); setPreferredTranscriber(e) }}
          credits={credits}
          calibration={calibration}
          calibrating={calibrating}
          calibrationPhrase={CALIBRATION_PHRASE}
          onCalibrate={() => { void calibrate() }}
          queue={queue}
          collecting={collecting}
          onCollecting={on => { setCollecting(on); collectingRef.current = on }}
          onRunQueue={runQueue}
          onClearQueue={() => { setQueue([]); offeredAt.current = 0 }}
          onDropQueued={i => setQueue(q => q.filter((_, n) => n !== i))}
          patience={patience}
          onPatience={v => {
            setPatienceState(v)
            patienceRef.current = v
            setVoicePatience(v)
          }}
          sensitivity={sensitivity}
          onSensitivity={v => {
            setSensitivityState(v)
            sensitivityRef.current = v
            setVoiceSensitivity(v)
          }}
          caption={caption}
          onCaption={on => { setCaption(on); writeVoiceCaption(on) }}
          onClose={() => { if (listening) finish(); setPanelOpen(false); setSide('none') }}
          colors={panelColors}
        />
      )}


      {typeAnim.mounted && (
        <div
          className={popClass(typeDir, typeAnim.leaving)}
          style={{
            position: 'absolute', zIndex: 60,
            // Anchored to whichever edge it grows from, so it never covers the
            // button that opened it.
            ...(typeDir === 'up'
              ? { bottom: 'calc(100% + 8px)' }
              : { top: asking ? 104 : 26 }),
            right: 0,
            minWidth: 300, padding: 8, background: C.bgSurface,
            border: `1px solid ${C.border}`, borderRadius: 6,
            boxShadow: '0 10px 28px rgba(0,0,0,.5)',
          }}
          onClick={e => e.stopPropagation()}
        >
          <input
            autoFocus
            value={typed}
            onChange={e => setTyped(e.target.value)}
            onKeyDown={e => {
              // Enter runs it. Stopped here so the studio's own Enter binding —
              // and the voice shortcut — never see a keystroke meant for this
              // field.
              e.stopPropagation()
              if (e.key === 'Enter' && typed.trim()) {
                // ⚠️ This used to be `&& !busy`, so pressing Enter while the
                // assistant was still working did NOTHING AT ALL — no message,
                // no queue, the text just sat there. Somebody typing a command
                // that seems to be ignored types it again, and again, which is
                // exactly what "the voice control freezes" looks like from the
                // outside. Being told it is still working is the whole fix.
                if (busy) { setProblem('Still working on the last one…'); return }
                const t = typed.trim()
                setTyped(''); setShowType(false)
                void run(t)
              }
              if (e.key === 'Escape') { setShowType(false); setTyped('') }
            }}
            placeholder={asking ? 'your answer…' : 'e.g. loop bass 2 three more times'}
            style={{
              width: '100%', height: 26, padding: '0 8px', boxSizing: 'border-box',
              background: '#141414', border: `1px solid ${C.border}`, borderRadius: 4,
              color: C.textPrimary, fontSize: 11, outline: 'none',
            }}
          />
          <div style={{ color: C.textMuted, fontSize: 10, marginTop: 5 }}>
            Enter to run · Esc to close — same commands as speaking
          </div>
        </div>
      )}

    </div>
  )
}
