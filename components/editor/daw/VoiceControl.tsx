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
  const handle = useRef<SpeechHandle | null>(null)
  const available = useRef(false)

  useEffect(() => {
    available.current = isSpeechAvailable()
    setMode(readVoiceMode())
    setEnterRuns(readVoiceEnter())
  }, [])

  /** Send a finished sentence to the assistant and run whatever comes back. */
  const run = useCallback(async (spoken: string) => {
    const text = stripWakeWord(spoken)
    if (!text) { setProblem('I didn\'t catch that.'); return }
    setBusy(true); setProblem(''); setSaid('')
    try {
      const res = await fetch('/api/ai/assist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          module: 'music',
          messages: [{ role: 'user', content: text }],
          stateSummary: musicStateSummary(project),
        }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({} as { error?: string; needCredits?: boolean }))
        setProblem(e.needCredits ? 'Out of AI credits.' : (e.error || `Couldn't reach the assistant (${res.status}).`))
        return
      }
      const data = await res.json() as { message?: string; actions?: VoiceCall[] }
      const calls = data.actions ?? []
      if (!calls.length) {
        // The model chose to answer rather than act — usually because the
        // request was ambiguous. Its sentence is more useful than ours.
        setProblem(data.message?.trim() || 'I couldn\'t turn that into an edit.')
        return
      }
      const plan = planVoiceCalls(calls, project)
      if (plan.problem) { setProblem(plan.problem); return }
      for (const a of plan.actions) {
        const act = a as { type: string; action?: string }
        // Transport is not a reducer action — it is the engine.
        if (act.type === 'TRANSPORT') {
          if (act.action === 'stop' || act.action === 'pause') engine?.stop?.()
          else if (act.action === 'restart') { engine?.stop?.(); engine?.play?.() }
          else if (act.action === 'toggle') { engine?.isPlaying ? engine.stop?.() : engine?.play?.() }
          else engine?.play?.()
          continue
        }
        dispatch(act as never)
      }
      setSaid(plan.say)
    } catch {
      setProblem('Couldn\'t reach the assistant.')
    } finally {
      setBusy(false)
    }
  }, [project, dispatch, engine])

  // Does the user still want to be listening? Asking for the microphone is
  // asynchronous and the first ask shows a dialog, so in hold-to-talk the
  // button can easily be released before permission resolves. Without this the
  // recognition would start after the release and never be stopped — the
  // microphone stays open with nothing watching it.
  const wanted = useRef(false)

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
    const h = listen({
      onPartial: setHeard,
      onFinal: t => { setListening(false); void run(t) },
      onError: m => { setListening(false); setProblem(m) },
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
    handle.current?.stop()
    handle.current = null
    setListening(false)
  }, [])

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
