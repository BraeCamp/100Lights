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

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, Loader2, X, Settings2 } from 'lucide-react'
import { useDaw, reducer as dawReducer, type DawAction } from '@/lib/daw-state'
import { isSpeechAvailable, listen, requestMic, stripWakeWord, type SpeechHandle } from '@/lib/voice/speech'
import { musicStateSummary } from '@/lib/voice/music-tools'
import { hearBetter } from '@/lib/voice/hear-better'
import { resolveLocally, resolveHeard, confidentEnough } from '@/lib/voice/local-resolve'
import type { Heard } from '@/lib/voice/hypotheses'
import { COMMAND_VOCABULARY, commandHelp } from '@/lib/voice/interpret'
import { remember, markFailed } from '@/lib/voice/voice-memory'
import {
  startRecording, preferredTranscriber, setPreferredTranscriber,
  type Recording, type StopResult, type MicReport,
} from '@/lib/voice/record'
import { planVoiceCalls, type VoiceCall } from '@/lib/voice/execute-music'
import { readChoice, readYesNo, type VoiceAsk, type AskOffer } from '@/lib/voice/ask'
import { noticeFor } from '@/lib/voice/notices'
import { considerUtterance, isAttentive, WAKE_WORDS } from '@/lib/voice/attention'
import { interpretSequence } from '@/lib/voice/sequence'
import {
  readQueueControl, askToImplement, readBack, reportRun, type QueuedCommand,
} from '@/lib/voice/queue'
import { hudOn, setHud, applyHud } from '@/lib/voice/hud'
import {
  CALIBRATION_PHRASE, phraseAccuracy, verdictFor, type CalibrationResult,
} from '@/lib/voice/calibrate'
import VoicePanel, { type VoiceTurn } from './VoicePanel'
import {
  speak, stopSpeaking, speechEnabled, setSpeechEnabled, speechAvailable,
  voiceSensitivity, setVoiceSensitivity,
} from '@/lib/voice/speak'

const C = {
  bgSurface: '#1c1c1c',
  border: 'var(--border)',
  accent: 'var(--accent)',
  textPrimary: '#e8e8e8',
  textMuted: '#7c7c7c',
} as const

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

export default function VoiceControl({ style }: { style?: React.CSSProperties }) {
  const { project, dispatch, engine, undo, redo, selectedTrackId, selectedClipId } = useDaw()
  const [listening, setListening] = useState(false)
  const [busy, setBusy] = useState(false)
  const [heard, setHeard] = useState('')
  const [said, setSaid] = useState('')
  const [problem, setProblem] = useState('')
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
  /** The assistant asked something and is waiting — a question, not a failure. */
  const [asking, setAsking] = useState('')
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

  /**
   * What was said, and what was said back.
   *
   * The voice system used to speak through popovers that replaced each other,
   * so the answer to "what did it just do" was already overwritten by the answer
   * to "what is it doing now". A transcript is the difference between an
   * interface you can check up on and one you have to take on faith.
   */
  const [turns, setTurns] = useState<VoiceTurn[]>([])
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelTab, setPanelTab] = useState<'talk' | 'settings' | 'help'>('talk')
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
  // Read by the recorder's callbacks, which outlive the render that made them.
  const sensitivityRef = useRef(1)

  const addTurn = useCallback((by: VoiceTurn['by'], text: string, ignored = false) => {
    if (!text?.trim()) return
    // Bounded. A session left running all afternoon should not grow without
    // limit, and nobody scrolls back past the last few exchanges.
    setTurns(t => [...t.slice(-60), { by, text: text.trim(), at: Date.now(), ignored }])
  }, [])
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
  const [attentive, setAttentive] = useState(false)

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
  ) => {
    if (kind === 'problem') setProblem(text)
    else setSaid(text)
    addTurn('light', text)
    // isPlaying is a PROPERTY, not a method. Calling it threw, which left the
    // control stuck busy and silently blocked every command after the first —
    // a one-character mistake that looked like the whole feature had broken.
    //
    // With the microphone held open across commands it is still listening when
    // there is something to say, so staying silent would mean never speaking at
    // all in the mode where speaking is most useful. It is deafened for the
    // duration instead — audio captured while the studio talks is discarded, so
    // it cannot transcribe its own read-back and act on it.
    const held = recorder.current
    if (held) {
      held.setMuted(true)
      speak(text, { kind, playing: !!engine?.isPlaying, onDone: () => held.setMuted(false) })
    } else {
      speak(text, { kind, playing: !!engine?.isPlaying, listening })
    }
  }, [engine, listening])
  const handle = useRef<SpeechHandle | null>(null)
  /** Set when recording instead of using the browser's recogniser. */
  const recorder = useRef<Recording | null>(null)
  const available = useRef(false)

  useEffect(() => {
    available.current = isSpeechAvailable()
    setMode(readVoiceMode())
    setSpeaks(speechEnabled())
    modeRef.current = readVoiceMode()
    const on = hudOn()
    setHudState(on)
    applyHud(on)
    const sens = voiceSensitivity()
    setSensitivityState(sens)
    sensitivityRef.current = sens
    setEnterRuns(readVoiceEnter())
  }, [])

  /** Apply one planned action. Transport is the engine, everything else the
   *  reducer — shared so the local and assistant paths cannot drift apart. */
  const runAction = useCallback((a: unknown) => {
    const act = a as { type: string; action?: string; beat?: number }
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
    dispatch(act as never)
  }, [dispatch, engine])

  /** Send a finished sentence to the assistant and run whatever comes back. */
  const run = useCallback(async (
    spoken: string,
    heardConfidence = 1,
    confirmed = false,
    /** Everything the recogniser reported, when this came from a microphone.
     *  Typed commands have no such thing and pass only the words. */
    heard?: Heard,
  ) => {
    // ── Was this meant for the studio at all? ───────────────────────────────
    //
    // Every filter before this one answers "is that a voice". With the
    // microphone held open across a room, the question that matters is whether
    // the voice was talking to US, and nothing acoustic can answer it: somebody
    // across the room saying "stop" is a person clearly saying stop.
    //
    // Checked on the RAW sentence, because stripWakeWord below removes the name
    // — it was written when the wake word was optional decoration and the
    // button meant "I am talking to you". Holding the button still means that.
    // Clicking it once and walking away does not.
    let heardFrom = spoken
    //
    // Only for SPOKEN input. `heard` is present when this came from a
    // microphone and absent when it was typed, and typing a command is already
    // an unambiguous act of addressing the studio — demanding its name from
    // somebody using the keyboard would be asking them to prove something they
    // just did.
    // ── Collecting listens freely, because collecting does nothing ──────────
    //
    // Brae: "I have to say Light before it acts upon anything", and then, on
    // saying "start": "it responded with 'Not acted on'. Why?"
    //
    // Because the session had gone quiet and the name is what wakes it. That
    // guard exists to stop the room executing commands — and while collecting,
    // NOTHING executes. Every command is written down, read back and waits for
    // "execute", so the worst a stray sentence can do is add a line to a list
    // somebody is about to read. Asking for the name to add to a list nobody
    // has approved is a toll on the safe half of the feature.
    //
    // Executing still asks. That is where the risk actually lives.
    const guarded = heard && continuousRef.current && !collectingRef.current
    if (guarded && !confirmed && !pendingAsk2 && !pendingOffer && !pendingName) {
      const verdict = considerUtterance({
        text: spoken,
        confidence: heardConfidence,
        now: Date.now(),
        lastAcceptedAt: lastAcceptedAt.current,
        continuous: true,
        // The context check for a name that only SOUNDED right. "Late" is
        // somebody talking about the time; "late, mute the drums" is a
        // microphone that misheard "light".
        looksLikeCommand: t => resolveLocally(t, {
          tracks: project.tracks ?? [],
          tempo: project.tempo,
        }).calls.length > 0,
      })
      if (!verdict.act) {
        setBusy(false)
        // Recorded even though it was not acted on. "It heard me and did
        // nothing" is a fact worth being able to see — otherwise the only
        // evidence is that nothing happened.
        addTurn('you', spoken, true)
        // Two very different situations, and telling them apart is what keeps
        // this from being infuriating. A room having a conversation must
        // produce NOTHING. Somebody who gave a real command and forgot the name
        // is told which word is missing — without it being acted on.
        const looksLikeCommand = resolveLocally(spoken, {
          tracks: project.tracks ?? [],
          tempo: project.tempo,
        }).calls.length > 0
        if (looksLikeCommand) {
          setHeard(spoken)
          // Spoken, not merely displayed. "It did nothing and I do not know
          // why" is the complaint this is answering, and a line of grey text
          // beside a button is not an answer when you are looking at the
          // arrangement.
          respond(
            `Say "${WAKE_WORDS[0]}" first, or start collecting and nothing will run until you say execute.`,
            'problem',
          )
        }
        return
      }
      // Being addressed starts a conversation, so the name is not needed again
      // for the next command.
      if (verdict.addressed) lastAcceptedAt.current = Date.now()
      heardFrom = verdict.text
      // "Light." on its own is somebody getting its attention and nothing more.
      if (!heardFrom.trim()) {
        setBusy(false)
        setProblem(''); setHeard(''); setSaid('Listening.')
        return
      }
    }

    const text = stripWakeWord(heardFrom)
    if (!text) { setProblem('I didn\'t catch that.'); return }
    addTurn('you', spoken)

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
      selectedTrackName: (project.tracks ?? []).find(t => t.id === selectedTrackId)?.name,
      // So "duplicate it" and "delete this" mean the clip on screen. Selecting
      // something is a statement about what you are working on, and the studio
      // should not need to be told twice.
      selectedClipId: selectedClipId ?? undefined,
      // So "Bass body 1" reads as one target — a track and an item said
      // together, which is the most specific thing anybody can say and was the
      // one form the rules could not see.
      clips: (project.arrangementClips ?? []).map(c => ({
        id: c.id, name: c.name, trackId: c.trackId,
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

    // ── One breath, possibly several commands ──────────────────────────────
    //
    // Typed or spoken: running two commands together is the same problem either
    // way, and somebody typing "solo the pad set the tempo to 132" means both.
    {
      const segments = interpretSequence(text, ctx)
      if (segments.length > 1) {
        lastAcceptedAt.current = Date.now()
        setBusy(false)
        const collected: QueuedCommand[] = []
        const ran: string[] = []
        const failed: string[] = []
        for (const seg of segments) {
          const plan = planVoiceCalls(seg.reading.calls, project)
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
    if (pendingAsk2) {
      const picked = readChoice(text, pendingAsk2.options)
      if (picked == null) {
        // Not an answer. It might be a change of subject, and a studio you
        // cannot walk away from mid-question is worse than one that never asks:
        // if the words are a command in their own right, the question is
        // abandoned and the command runs. Only genuine mumbling gets re-asked.
        const asCommand = resolveLocally(text, { tracks: project.tracks ?? [], tempo: project.tempo })
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
        const plan = planVoiceCalls(option.calls, project)
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
        const asCommand = resolveLocally(text, { tracks: project.tracks ?? [], tempo: project.tempo })
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
      )
      if (plan.problem) { respond(plan.problem, 'problem'); return }
      for (const a of plan.actions) runAction(a)
      respond(plan.say)
      return
    }

    // resolveHeard when the utterance came from a microphone: it can weigh what
    // the recogniser was unsure of, which is the difference between recovering
    // a mishearing and reporting one.
    const local = heard ? resolveHeard(heard, ctx) : resolveLocally(text, ctx)

    // ── The commands the editor carries out itself ───────────────────────────
    //
    // Undo needs the editor's history stack, which is not part of the project
    // and cannot be — so it is the one family that does not become reducer
    // actions. Intercepted here rather than pretended at in the executor.
    if (confidentEnough(local, heardConfidence)) {
      const name = local.calls[0]?.name
      if (name === 'undo' || name === 'redo') {
        const step = name === 'undo' ? undo : redo
        const did = step?.()
        setBusy(false)
        // Reports what actually happened. Saying "Undone." over an empty stack
        // is the kind of small lie that teaches someone to stop trusting the
        // read-back, and the read-back is the whole safety story here.
        if (did === false) setProblem(name === 'undo' ? 'Nothing to undo.' : 'Nothing to redo.')
        else if (!step) setProblem('Undo is not available here.')
        else setSaid(name === 'undo' ? 'Undone.' : 'Redone.')
        return
      }
    }

    if (confidentEnough(local, heardConfidence)) {
      const plan = planVoiceCalls(local.calls, project)
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
    if (local.calls.length && local.alternatives?.length) {
      const readings = [
        { id: local.matched, calls: local.calls },
        ...local.alternatives,
      ]
      const offered = readings
        .map(r => ({ label: planVoiceCalls(r.calls, project).say, calls: r.calls }))
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
    if (!confirmed) {
      setBusy(false)
      setPendingAsk(text)
      return
    }
    // Brae also said: "Full AI integration will be in the highest tier and only
    // when activated." That is a mode where this check is SKIPPED, and it is
    // deliberately not built yet — it needs the paid tiers to exist, and it
    // contradicts "every single time" until someone has explicitly turned it on.
    // When it arrives it belongs here, as an extra condition on `confirmed`,
    // and nowhere else.

    try {
      const res = await fetch('/api/ai/assist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          module: 'music',
          messages: [...history.current, { role: 'user', content: text }],
          stateSummary: musicStateSummary(project),
        }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({} as { error?: string; needCredits?: boolean }))
        // 401 is the route's own answer; 404 is Clerk's middleware refusing an
        // unauthenticated request BEFORE the route runs, which it does with a
        // 404 rather than a 401. Both mean the same thing to a person, and
        // "Couldn't reach the assistant (404)" reads like an outage rather than
        // like "sign in" — which sends people looking for a fault that is not
        // there. The local resolver still handles the common commands either
        // way, so this is a partial loss, not a dead feature.
        const signedOut = res.status === 401 || res.status === 404
        setProblem(
          e.needCredits ? 'Out of AI credits.'
            : signedOut ? 'Sign in to use the assistant. Simple commands still work without it.'
              : (e.error || `Couldn't reach the assistant (${res.status}).`))
        markFailed(e.error || `http ${res.status}`)
        return
      }
      const data = await res.json() as { message?: string; actions?: VoiceCall[] }
      const calls = data.actions ?? []
      if (!calls.length) {
        // The model answered rather than acted — usually a clarifying question,
        // sometimes a plain answer. Either way it is NOT an error, and showing
        // it as one was the reason clarification could never work: a question
        // styled like a failure invites you to give up, not to reply.
        //
        // So it becomes a question, the exchange is remembered, and the reply
        // box opens focused. Answering continues the same conversation.
        const reply = data.message?.trim() || 'I couldn\'t turn that into an edit.'
        history.current = [...history.current,
          { role: 'user' as const, content: text },
          { role: 'assistant' as const, content: reply }].slice(-8)
        remember({
          said: text, heard: heardConfidence, by: 'assistant',
          matched: local.matched, understood: local.confidence,
          calls: [], asked: reply,
        })
        setAsking(reply)
        setShowType(true)
        return
      }
      const plan = planVoiceCalls(calls, project)
      if (plan.problem) {
        markFailed(plan.problem)
        setProblem(plan.problem)
        return
      }
      for (const a of plan.actions) runAction(a)
      // Every assistant answer is a worked example of a sentence the local
      // resolver could not handle. Sorted by frequency these become the build
      // order for replacing it — the phrasings actually used, ranked by use.
      remember({
        said: text, alternatives: undefined, heard: heardConfidence, by: 'assistant',
        matched: local.matched, understood: local.confidence,
        calls, said_back: plan.say,
      })
      // Done — the exchange is closed, so the next command starts clean rather
      // than inheriting the last one's context.
      history.current = []
      setAsking('')
      setSaid(plan.say)
    } catch {
      setProblem('Couldn\'t reach the assistant.')
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
  }, [project, runAction, pendingAsk2, pendingOffer, pendingName, respond, undo, redo,
    selectedTrackId, selectedClipId, queue])

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
    words?: { word: string; confidence: number }[],
  ) => {
    // A continuous session is still listening: the sentence ended, the take did
    // not. Clearing it here made the button claim to be off while the
    // microphone was open, which is the one thing a microphone indicator must
    // never get wrong.
    if (!continuousRef.current) setListening(false)
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
      onUtterance: r => handleTake(r),
      // A live meter, because "is it even hearing me" is the first question
      // when this goes wrong and it should not need asking twice.
      onLevel: (l, bar) => { setLevel(l); setThreshold(bar) },
      onSpeechStart: () => setProblem(''),
      // It ends itself once talking stops, so the trailing room does not get
      // recorded. finish() is what turns the take into a command.
      // Through a ref: finish() is defined below this callback, and the take
      // can end itself at any moment, so capturing it directly would either
      // read a stale closure or force an ordering that has nothing to do with
      // how the code is best read.
      onSilence: () => { finishRef.current?.() },
    })
    if (!rec) { setProblem('Could not open the microphone.'); return }
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
    setPanelTab('talk')
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
      onPartial: setHeard,
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
    if (!r.result || !r.result.text) { setProblem('I didn\'t catch that.'); return }
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
      const plan = planVoiceCalls(item.calls, project)
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
      setProblem('Could not open the microphone.')
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

  // Only while a held-open session is running: nothing to show otherwise, and
  // no reason to keep a timer alive.
  useEffect(() => {
    if (!listening || !continuousRef.current) { setAttentive(false); return }
    const tick = () => setAttentive(isAttentive(Date.now(), lastAcceptedAt.current))
    tick()
    const id = setInterval(tick, 1500)
    return () => clearInterval(id)
  }, [listening])

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

  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', ...style }}>
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
          // setting currently is.
          setPanelTab('settings')
          setPanelOpen(v => !(v && panelTab === 'settings'))
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

      {panelOpen && (
        <VoicePanel
          turns={turns}
          listening={listening}
          attentive={attentive}
          continuous={continuousRef.current}
          level={level}
          hud={hud}
          initialTab={panelTab}
          mode={mode}
          onMode={m => { setMode(m); modeRef.current = m; writeVoiceMode(m) }}
          enterRuns={enterRuns}
          onEnterRuns={on => { setEnterRuns(on); writeVoiceEnter(on) }}
          speaks={speaks}
          onSpeaks={on => { setSpeaks(on); setSpeechEnabled(on) }}
          canSpeak={speechAvailable()}
          onHud={on => { setHudState(on); setHud(on) }}
          mic={mic}
          threshold={threshold}
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
          sensitivity={sensitivity}
          onSensitivity={v => {
            setSensitivityState(v)
            sensitivityRef.current = v
            setVoiceSensitivity(v)
          }}
          onClose={() => setPanelOpen(false)}
          onClear={() => setTurns([])}
          colors={{
            bgSurface: C.bgSurface, border: C.border, textPrimary: C.textPrimary,
            textMuted: C.textMuted, accent: C.accent,
          }}
        />
      )}

      {(pendingAsk2 || pendingOffer || pendingName) && (
        <div
          style={{
            position: 'absolute', top: 26, right: 0, zIndex: 64,
            width: 360, padding: 10, background: C.bgSurface,
            border: `1px solid ${C.accent}`, borderRadius: 6,
            boxShadow: '0 10px 28px rgba(0,0,0,.5)', fontSize: 11, color: C.textPrimary,
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {pendingAsk2.options.map((option, i) => (
                <button
                  key={i}
                  onClick={() => answerByHand(option.label)}
                  style={{
                    textAlign: 'left', padding: '7px 9px', borderRadius: 4, cursor: 'pointer',
                    border: `1px solid ${C.border}`, background: '#141414',
                    color: C.textPrimary, fontSize: 11, lineHeight: 1.35,
                  }}
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
            position: 'absolute', top: 26, right: 0, zIndex: 63,
            width: 340, padding: 10, background: C.bgSurface,
            border: '1px solid #b4453a', borderRadius: 6,
            boxShadow: '0 10px 28px rgba(0,0,0,.5)', fontSize: 11, color: C.textPrimary,
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
                const plan = planVoiceCalls(pendingDo.calls, project)
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
            position: 'absolute', top: 26, right: 0, zIndex: 62,
            width: 340, padding: 10, background: C.bgSurface,
            border: `1px solid ${C.border}`, borderRadius: 6,
            boxShadow: '0 10px 28px rgba(0,0,0,.5)', fontSize: 11, color: C.textPrimary,
          }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ color: C.textMuted, fontSize: 9, fontWeight: 800, letterSpacing: 0.5, marginBottom: 6 }}>
            WHICH DID YOU MEAN?
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {choices.map((choice, i) => (
              <button
                key={i}
                onClick={() => {
                  const plan = planVoiceCalls(choice.calls, project)
                  setChoices(null)
                  if (plan.problem) { setProblem(plan.problem); return }
                  for (const a of plan.actions) runAction(a)
                  setSaid(plan.say)
                }}
                style={{
                  textAlign: 'left', padding: '7px 9px', borderRadius: 4, cursor: 'pointer',
                  border: `1px solid ${C.border}`, background: '#141414',
                  color: C.textPrimary, fontSize: 11, lineHeight: 1.35,
                }}
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
            position: 'absolute', top: 26, right: 0, zIndex: 62,
            width: 340, padding: 10, background: C.bgSurface,
            border: `1px solid ${C.accent}`, borderRadius: 6,
            boxShadow: '0 10px 28px rgba(0,0,0,.5)', fontSize: 11, color: C.textPrimary,
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
            Uses AI credits. Fix the words above and press Enter to try again for free.
          </div>
        </div>
      )}

      {asking && (
        <div
          style={{
            position: 'absolute', top: 26, right: 0, zIndex: 61,
            minWidth: 300, maxWidth: 360, padding: '8px 10px',
            background: C.bgSurface, border: `1px solid ${C.accent}`, borderRadius: 6,
            boxShadow: '0 10px 28px rgba(0,0,0,.5)',
            fontSize: 11, lineHeight: 1.45, color: C.textPrimary,
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

      {showType && (
        <div
          style={{
            position: 'absolute', top: asking ? 104 : 26, right: 0, zIndex: 60,
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
              if (e.key === 'Enter' && typed.trim() && !busy) {
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

      {(heard || said || problem) && (
        <div
          data-voice-readback
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 70,
            minWidth: 260, maxWidth: 460, padding: '8px 10px',
            background: C.bgSurface, border: `1px solid ${problem ? '#5a2a2a' : C.border}`,
            borderRadius: 6, boxShadow: '0 10px 28px rgba(0,0,0,.5)',
            fontSize: 11, lineHeight: 1.45, color: C.textPrimary,
          }}
        >
          {heard && !said && !problem && (
            <div style={{ color: C.textMuted }}>“{heard}”</div>
          )}
          {said && <div style={{ color: C.accent }}>{said}</div>}
          {listening && continuousRef.current && !said && !problem && (
            <div style={{ color: attentive ? C.accent : C.textMuted }}>
              {attentive
                ? 'Listening — go ahead.'
                : `On, but quiet. Say "${WAKE_WORDS[0]}" to wake it.`}
            </div>
          )}
          {problem && <div style={{ color: '#ffb4b4' }}>{problem}</div>}
          <button
            onClick={() => { setHeard(''); setSaid(''); setProblem('') }}
            aria-label="Dismiss"
            style={{
              position: 'absolute', top: 4, right: 4, display: 'inline-flex',
              border: 'none', background: 'transparent', color: C.textMuted, cursor: 'pointer', padding: 2,
            }}
          ><X size={11} /></button>
        </div>
      )}
    </div>
  )
}
