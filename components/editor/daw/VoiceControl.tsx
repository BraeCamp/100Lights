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
import { useDaw } from '@/lib/daw-state'
import { isSpeechAvailable, listen, requestMic, stripWakeWord, type SpeechHandle } from '@/lib/voice/speech'
import { musicStateSummary } from '@/lib/voice/music-tools'
import { hearBetter } from '@/lib/voice/hear-better'
import { resolveLocally, confidentEnough } from '@/lib/voice/local-resolve'
import { remember, markFailed } from '@/lib/voice/voice-memory'
import { startRecording, preferredTranscriber, setPreferredTranscriber, type Recording } from '@/lib/voice/record'
import { planVoiceCalls, type VoiceCall } from '@/lib/voice/execute-music'

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
  const { project, dispatch, engine } = useDaw()
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
  const handle = useRef<SpeechHandle | null>(null)
  /** Set when recording instead of using the browser's recogniser. */
  const recorder = useRef<Recording | null>(null)
  const available = useRef(false)

  useEffect(() => {
    available.current = isSpeechAvailable()
    setMode(readVoiceMode())
    setEnterRuns(readVoiceEnter())
  }, [])

  /** Apply one planned action. Transport is the engine, everything else the
   *  reducer — shared so the local and assistant paths cannot drift apart. */
  const runAction = useCallback((a: unknown) => {
    const act = a as { type: string; action?: string }
    if (act.type === 'TRANSPORT') {
      if (act.action === 'stop' || act.action === 'pause') engine?.stop?.()
      else if (act.action === 'restart') { engine?.stop?.(); engine?.play?.() }
      else if (act.action === 'toggle') { if (engine?.isPlaying) engine.stop?.(); else engine?.play?.() }
      else engine?.play?.()
      return
    }
    dispatch(act as never)
  }, [dispatch, engine])

  /** Send a finished sentence to the assistant and run whatever comes back. */
  const run = useCallback(async (spoken: string, heardConfidence = 1) => {
    const text = stripWakeWord(spoken)
    if (!text) { setProblem('I didn\'t catch that.'); return }
    setBusy(true); setProblem(''); setSaid(''); setAsking('')

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
    const local = resolveLocally(text, { tracks: project.tracks ?? [] })
    if (confidentEnough(local, heardConfidence)) {
      const plan = planVoiceCalls(local.calls, project)
      if (!plan.problem) {
        for (const a of plan.actions) runAction(a)
        remember({
          said: text, heard: heardConfidence, by: 'local',
          matched: local.matched, understood: local.confidence,
          calls: local.calls, said_back: plan.say,
        })
        history.current = []
        setAsking('')
        setSaid(plan.say)
        setBusy(false)
        return
      }
      // Local built something the executor rejected — fall through to the
      // assistant rather than reporting, since that is precisely a case local
      // does not yet understand well enough.
    }

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
  }, [project, runAction])

  // Does the user still want to be listening? Asking for the microphone is
  // asynchronous and the first ask shows a dialog, so in hold-to-talk the
  // button can easily be released before permission resolves. Without this the
  // recognition would start after the release and never be stopped — the
  // microphone stays open with nothing watching it.
  const wanted = useRef(false)

  /** A finished sentence, from either transcriber. Same treatment either way:
   *  choose among alternatives using the project's real names, repair them,
   *  then run it. */
  const heardSentence = useCallback((text: string, alternatives: string[][], confidence: number) => {
    setListening(false)
    const heardBest = alternatives.length
      ? alternatives.map(a => hearBetter(a, project.tracks ?? [])).join(' ')
      : hearBetter([text], project.tracks ?? [])
    setHeard(heardBest)
    void run(heardBest || text, confidence)
  }, [project, run])

  /** Record and transcribe on the server — the path that does not go through
   *  the browser's speech service. */
  const startRecorded = useCallback(async () => {
    setProblem('Listening…')
    const rec = await startRecording()
    if (!rec) { setProblem('Could not open the microphone.'); return }
    if (!wanted.current) { rec.cancel(); setProblem(''); return }
    recorder.current = rec
    setProblem('')
    setListening(true)
  }, [])

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
          setProblem('Your browser can\'t reach its speech service — switched to recording. Try again.')
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
    setListening(true)
  }, [listening, busy, run])

  const finish = useCallback(() => {
    wanted.current = false
    if (recorder.current) {
      const rec = recorder.current
      recorder.current = null
      setListening(false)
      setBusy(true)
      void rec.stop().then(r => {
        setBusy(false)
        if (!r || !r.text) { setProblem('I didn\'t catch that.'); return }
        heardSentence(r.text, r.alternatives.length ? [r.alternatives] : [], r.confidence)
      })
      return
    }
    handle.current?.stop()
    handle.current = null
    setListening(false)
  }, [heardSentence])

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
        onClick={e => { e.stopPropagation(); setShowSettings(v => !v) }}
        data-voice-settings
        aria-label="Voice settings"
        title="How the voice button works"
        style={{
          marginLeft: 2, display: 'inline-flex', alignItems: 'center', height: 22,
          padding: '0 4px', border: 'none', background: 'transparent',
          color: C.textMuted, cursor: 'pointer',
        }}
      ><Settings2 size={11} /></button>

      {showSettings && (
        <div
          data-voice-settings-panel
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 75,
            minWidth: 230, padding: 8, background: C.bgSurface,
            border: `1px solid ${C.border}`, borderRadius: 6,
            boxShadow: '0 10px 28px rgba(0,0,0,.5)', fontSize: 11, color: C.textPrimary,
          }}
        >
          <div style={{ color: C.textMuted, marginBottom: 6, letterSpacing: 0.3 }}>SPEAKING</div>
          {(['hold', 'toggle'] as VoiceMode[]).map(m => (
            <label key={m} style={{ display: 'flex', gap: 7, alignItems: 'center', padding: '3px 0', cursor: 'pointer' }}>
              <input
                type="radio" name="voice-mode" checked={mode === m}
                onChange={() => { setMode(m); writeVoiceMode(m) }}
              />
              {m === 'hold' ? 'Hold the button to speak' : 'Click to start, click to run'}
            </label>
          ))}
          <div style={{ height: 1, background: C.border, margin: '7px 0' }} />
          <label style={{ display: 'flex', gap: 7, alignItems: 'flex-start', cursor: 'pointer' }}>
            <input
              type="checkbox" checked={enterRuns}
              onChange={e => { setEnterRuns(e.target.checked); writeVoiceEnter(e.target.checked) }}
              style={{ marginTop: 2 }}
            />
            <span>
              Enter starts and runs a command
              <span style={{ display: 'block', color: C.textMuted, marginTop: 2 }}>
                Only while you are not typing — Enter keeps its usual job in any field.
              </span>
            </span>
          </label>
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
