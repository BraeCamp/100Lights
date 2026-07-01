'use client'

import { useEffect, useRef, useState } from 'react'
import { Mic, Square, Upload, CheckCircle2, Clock, AlertCircle, Radio } from 'lucide-react'

type Phase =
  | 'loading'
  | 'name'       // guest enters their name
  | 'waiting'    // waiting for host to start
  | 'ready'      // host started — guest can record
  | 'recording'
  | 'uploading'
  | 'done'
  | 'error'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? ''

// ── NTP clock sync ──────────────────────────────────────────────────────────
async function syncClock(token: string): Promise<number> {
  const offsets: number[] = []
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now()
    const res = await fetch(`/api/guest/${token}/time`)
    const t1 = Date.now()
    const { serverTime } = await res.json() as { serverTime: number }
    offsets.push(serverTime + (t1 - t0) / 2 - t1)
  }
  offsets.sort((a, b) => a - b)
  return offsets[2] // median
}

// ── Sync beep ───────────────────────────────────────────────────────────────
function playBeep() {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 1000
    gain.gain.setValueAtTime(0.6, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.4)
  } catch {}
}

export default function GuestPage({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken]         = useState('')
  const [phase, setPhase]         = useState<Phase>('loading')
  const [guestName, setGuestName] = useState('')
  const [errorMsg, setErrorMsg]   = useState('')
  const [uploadPct, setUploadPct] = useState(0)

  // Waveform
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const analyserRef  = useRef<AnalyserNode | null>(null)
  const animFrameRef = useRef<number>(0)

  // Recording state
  const mediaRecRef  = useRef<MediaRecorder | null>(null)
  const chunksRef    = useRef<Blob[]>([])
  const clockOffset  = useRef(0)
  const recStartMs   = useRef(0)
  const recDuration  = useRef(0)
  const [elapsed, setElapsed] = useState(0)
  const elapsedInterval = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    params.then(p => {
      setToken(p.token)
      // Verify the session exists
      fetch(`/api/guest/${p.token}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (!data) { setErrorMsg('This invite link is invalid or has expired.'); setPhase('error'); return }
          if (data.status === 'uploaded' || data.status === 'pulled') {
            setPhase('done')
          } else {
            setPhase('name')
          }
        })
        .catch(() => { setErrorMsg('Unable to reach server.'); setPhase('error') })
    })
  }, [params])

  async function submitName() {
    if (!guestName.trim()) return
    await fetch(`/api/guest/${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ guestName: guestName.trim() }),
    })
    // Sync clock while transitioning
    clockOffset.current = await syncClock(token)
    setPhase('waiting')
    pollForStart()
  }

  function pollForStart() {
    const id = setInterval(async () => {
      const res = await fetch(`/api/guest/${token}`).catch(() => null)
      if (!res?.ok) return
      const data = await res.json() as { status: string }
      if (data.status === 'ready') {
        clearInterval(id)
        playBeep()
        setPhase('ready')
      }
    }, 2000)
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

      // Waveform visualiser
      const audioCtx  = new AudioContext()
      const source    = audioCtx.createMediaStreamSource(stream)
      const analyser  = audioCtx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      analyserRef.current = analyser
      drawWaveform()

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/ogg;codecs=opus'

      const rec = new MediaRecorder(stream, { mimeType })
      chunksRef.current = []
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      rec.start(250) // 250ms chunks for smooth stop

      mediaRecRef.current = rec
      recStartMs.current  = Date.now() + clockOffset.current  // server-relative start time
      setElapsed(0)
      elapsedInterval.current = setInterval(() => setElapsed(s => s + 1), 1000)

      playBeep()
      setPhase('recording')
    } catch {
      setErrorMsg('Could not access microphone. Please allow microphone access and try again.')
      setPhase('error')
    }
  }

  async function stopRecording() {
    if (!mediaRecRef.current) return
    cancelAnimationFrame(animFrameRef.current)
    if (elapsedInterval.current) clearInterval(elapsedInterval.current)

    await new Promise<void>(resolve => {
      mediaRecRef.current!.onstop = () => resolve()
      mediaRecRef.current!.stop()
      mediaRecRef.current!.stream.getTracks().forEach(t => t.stop())
    })

    recDuration.current = elapsed * 1000
    setPhase('uploading')
    await upload()
  }

  async function upload() {
    const mimeType = chunksRef.current[0]?.type ?? 'audio/webm'
    const blob     = new Blob(chunksRef.current, { type: mimeType })

    try {
      // 1. Get presigned URL
      const presignRes = await fetch(`/api/guest/${token}/presign`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mimeType }),
      })
      const { uploadUrl, key } = await presignRes.json() as { uploadUrl: string; key: string }

      // 2. Upload directly to R2 with progress tracking via XHR
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('PUT', uploadUrl)
        xhr.setRequestHeader('Content-Type', mimeType)
        xhr.upload.onprogress = e => {
          if (e.lengthComputable) setUploadPct(Math.round((e.loaded / e.total) * 100))
        }
        xhr.onload  = () => (xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`)))
        xhr.onerror = () => reject(new Error('Network error'))
        xhr.send(blob)
      })

      // 3. Confirm with timestamps
      await fetch(`/api/guest/${token}/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          r2Key:            key,
          recordingStartMs: recStartMs.current,
          durationMs:       recDuration.current || blob.size / 16, // rough fallback
        }),
      })

      setPhase('done')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Upload failed. Please try again.')
      setPhase('error')
    }
  }

  function drawWaveform() {
    const canvas   = canvasRef.current
    const analyser = analyserRef.current
    if (!canvas || !analyser) return

    const ctx  = canvas.getContext('2d')!
    const data = new Uint8Array(analyser.frequencyBinCount)

    const capturedAnalyser = analyser
    const capturedCanvas   = canvas
    function draw() {
      animFrameRef.current = requestAnimationFrame(draw)
      capturedAnalyser.getByteTimeDomainData(data)
      ctx.clearRect(0, 0, capturedCanvas.width, capturedCanvas.height)
      ctx.beginPath()
      ctx.strokeStyle = '#8b5cf6'
      ctx.lineWidth   = 2
      const sliceWidth = capturedCanvas.width / data.length
      let x = 0
      for (let i = 0; i < data.length; i++) {
        const v = data[i] / 128
        const y = (v * capturedCanvas.height) / 2
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
        x += sliceWidth
      }
      ctx.stroke()
    }
    draw()
  }

  function formatElapsed(s: number) {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${String(sec).padStart(2, '0')}`
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#0d0d14', padding: 24,
    }}>
      <div style={{
        width: '100%', maxWidth: 420, borderRadius: 20,
        background: '#12121e', border: '1px solid rgba(255,255,255,0.08)',
        padding: '40px 36px', display: 'flex', flexDirection: 'column', gap: 28,
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: '#8b5cf6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
              <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
            </svg>
          </div>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#f4f4f5' }}>100Lights</span>
          <span style={{ fontSize: 12, color: '#71717a', marginLeft: 4 }}>Guest Recording</span>
        </div>

        {/* ── Name entry ── */}
        {phase === 'name' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 700, color: '#f4f4f5', margin: '0 0 6px' }}>
                You've been invited to record
              </h1>
              <p style={{ fontSize: 13, color: '#a1a1aa', margin: 0 }}>
                Enter your name so the host knows it's you, then wait for them to start the session.
              </p>
            </div>
            <input
              autoFocus
              placeholder="Your name"
              value={guestName}
              onChange={e => setGuestName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submitName()}
              style={{
                padding: '12px 14px', borderRadius: 10, fontSize: 15,
                background: '#1c1c2e', border: '1px solid rgba(255,255,255,0.12)',
                color: '#f4f4f5', outline: 'none',
              }}
            />
            <button
              onClick={submitName}
              disabled={!guestName.trim()}
              style={{
                padding: '12px 0', borderRadius: 10, fontSize: 14, fontWeight: 600,
                background: guestName.trim() ? '#8b5cf6' : '#27272a',
                color: guestName.trim() ? '#fff' : '#52525b',
                border: 'none', cursor: guestName.trim() ? 'pointer' : 'not-allowed',
              }}
            >
              Join session
            </button>
          </div>
        )}

        {/* ── Waiting ── */}
        {phase === 'waiting' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '16px 0' }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Clock size={24} color="#8b5cf6" />
            </div>
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 16, fontWeight: 600, color: '#f4f4f5', margin: '0 0 6px' }}>
                Hi, {guestName} — you're in!
              </p>
              <p style={{ fontSize: 13, color: '#a1a1aa', margin: 0 }}>
                Waiting for the host to start the session. Keep this tab open.
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#8b5cf6', animation: 'pulse 1.5s ease-in-out infinite' }} />
              <span style={{ fontSize: 12, color: '#71717a' }}>Listening for host…</span>
            </div>
          </div>
        )}

        {/* ── Ready ── */}
        {phase === 'ready' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, padding: '8px 0' }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Radio size={24} color="#10b981" />
            </div>
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 16, fontWeight: 600, color: '#f4f4f5', margin: '0 0 6px' }}>Session started!</p>
              <p style={{ fontSize: 13, color: '#a1a1aa', margin: 0 }}>
                Put on headphones to avoid echo, then hit record when you're ready.
              </p>
            </div>
            <button
              onClick={startRecording}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '14px 32px', borderRadius: 999, fontSize: 15, fontWeight: 700,
                background: '#ef4444', color: '#fff', border: 'none', cursor: 'pointer',
              }}
            >
              <Mic size={18} /> Start recording
            </button>
          </div>
        )}

        {/* ── Recording ── */}
        {phase === 'recording' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444', animation: 'pulse 1s ease-in-out infinite' }} />
              <span style={{ fontSize: 22, fontWeight: 700, color: '#f4f4f5', fontVariantNumeric: 'tabular-nums' }}>
                {formatElapsed(elapsed)}
              </span>
            </div>

            <canvas
              ref={canvasRef}
              width={320} height={64}
              style={{ width: '100%', height: 64, borderRadius: 8, background: '#1c1c2e' }}
            />

            <button
              onClick={stopRecording}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '14px 32px', borderRadius: 999, fontSize: 15, fontWeight: 700,
                background: '#27272a', color: '#f4f4f5', border: '2px solid #ef4444', cursor: 'pointer',
              }}
            >
              <Square size={16} fill="#ef4444" color="#ef4444" /> Stop & submit
            </button>
            <p style={{ fontSize: 11, color: '#52525b', textAlign: 'center', margin: 0 }}>
              Your recording is saved locally until you hit submit.
            </p>
          </div>
        )}

        {/* ── Uploading ── */}
        {phase === 'uploading' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '16px 0' }}>
            <Upload size={32} color="#8b5cf6" />
            <p style={{ fontSize: 15, fontWeight: 600, color: '#f4f4f5', margin: 0 }}>Uploading your recording…</p>
            <div style={{ width: '100%', height: 6, borderRadius: 3, background: '#27272a', overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 3, background: '#8b5cf6', width: `${uploadPct}%`, transition: 'width 0.2s' }} />
            </div>
            <span style={{ fontSize: 12, color: '#71717a' }}>{uploadPct}%</span>
          </div>
        )}

        {/* ── Done ── */}
        {phase === 'done' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '16px 0' }}>
            <CheckCircle2 size={48} color="#10b981" />
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 16, fontWeight: 700, color: '#f4f4f5', margin: '0 0 6px' }}>Recording submitted!</p>
              <p style={{ fontSize: 13, color: '#a1a1aa', margin: 0 }}>
                The host will pull your track into the project. You can close this tab.
              </p>
            </div>
          </div>
        )}

        {/* ── Error ── */}
        {phase === 'error' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '16px 0' }}>
            <AlertCircle size={40} color="#ef4444" />
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 15, fontWeight: 600, color: '#f4f4f5', margin: '0 0 8px' }}>Something went wrong</p>
              <p style={{ fontSize: 13, color: '#a1a1aa', margin: 0 }}>{errorMsg}</p>
            </div>
          </div>
        )}

        {phase === 'loading' && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0' }}>
            <span style={{ fontSize: 13, color: '#71717a' }}>Loading…</span>
          </div>
        )}

        <p style={{ fontSize: 11, color: '#3f3f46', textAlign: 'center', margin: 0 }}>
          Powered by 100Lights · Your audio goes directly to the host's project
        </p>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  )
}
