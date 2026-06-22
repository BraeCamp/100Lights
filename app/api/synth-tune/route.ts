const ITER_TASKS = [
  `ITERATION 1 — Spectral Transformation & Synth Filter Character:
The goal is to make the original voice recording sound like it's being played through
an analog synthesizer — NOT rebuilding from oscillators, but PROCESSING the actual audio.
The original recording already has the right timing, dynamics, and feel. Your job is to
reshape its harmonic spectrum to sound synthesized.

IMPLEMENTATION RULES (do all of these):
1. Use an OfflineAudioContext. Connect: src (originalBuf) → waveshaper → filter → gain → destination.
2. Design a WaveShaper curve that emphasizes odd harmonics for a square/synth character.
   The arctan formula: curve[i] = ((π + k) * x) / (π + k * |x|) where k controls saturation intensity.
   Use k between 6–14 based on whether the recording has many notes (higher k = more aggression).
3. The filter is the most important element — it defines the synth's personality:
   - Use BiquadFilterNode type 'bandpass' or 'lowpass'
   - Q value of 3–8 (higher Q = more resonance = more synthesizer character)
   - Cutoff frequency derived from the median fundamental: midiToFreq(medianMidi) * 3 to midiToFreq(medianMidi) * 6
4. Set gain.gain.value to compensate for the waveshaper's output level (usually 0.65–0.8).
5. Use originalBuf.numberOfChannels for the OfflineAudioContext channel count.

USE THE PITCH DATA: Calculate the median MIDI note from pitchCurve to set an appropriate
filter cutoff. Higher-pitched recordings need a higher cutoff. Look at the note count and
average duration to judge how much saturation is appropriate.`,

  `ITERATION 2 — Note-Synchronized Envelope & Gate:
Building on the spectral transformation, now make it react to the actual musical phrases:
1. Extract note events using extractNoteEvents(pitchCurve). For each note:
   - Open the filter cutoff wider at note onset (attack), settle lower during sustain.
   - Use filter.frequency.setValueAtTime() and linearRampToValueAtTime() to create
     a per-note filter sweep: start at 1.5× the sustain cutoff, decay to sustain cutoff
     over the note's attack time.
2. Gate between notes: insert a gainNode before the waveshaper. Between notes where
   gapMs > 30ms, ramp gain to 0.05 for the gap duration, then back to 1.0 on the next
   note's start. This removes breath/room noise between notes.
3. Preserve the original audio's natural amplitude variation — do NOT flatten dynamics.
   The gain gating should only target the silences, not compress the notes themselves.
4. Incorporate ALL improvements from iteration 1 (saturation curve, filter character, gain).`,

  `ITERATION 3 — Harmonic Layering & Polish:
Complete the transformation with harmonic richness and final polish:
1. Add a ring modulator layer for metallic synth character:
   - Create an OscillatorNode at 2× the median fundamental frequency.
   - Create a GainNode with gain.value = 0 (this is the ring mod carrier).
   - Connect: osc → ringGain; ringGain → modulatorGain.gain (AudioParam modulation).
   - Connect: waveshaperOutput → modulatorGain → filter.
   - Mix ring mod in at ~0.15 depth (subtle — adds presence without harsh metallic quality).
2. Add a slight chorus effect by creating a second DelayNode (4–8ms) mixed at ~20% gain,
   fed from the same waveshaper output. This adds stereo width and "analog" feel.
3. Apply a gentle highpass filter (80Hz, Q=0.7) before the main filter to remove
   low-frequency rumble from the recording that wasn't part of the voice.
4. Incorporate ALL improvements from iterations 1 and 2 into this single unified rewrite.`,
]

interface NoteEvent {
  start: number; end: number; midi: number; amplitude: number
}
interface NoteStats {
  pitchVarianceCents: number
  sustainLevel: number
  attackMs: number
}
interface Transition {
  gapMs: number
  pitchJumpSemitones: number
}
interface TrajectoryPoint {
  t: number; hz: number | null; amp: number
}

interface TuneRequest {
  code:         string
  pitchSummary: {
    totalDuration:  number
    noteCount:      number
    avgDurationMs:  number
    pitchRangeMidi: { min: number; max: number } | null
    notes:      NoteEvent[]
    noteStats:  NoteStats[]
    transitions: Transition[]
    trajectory: TrajectoryPoint[]
  }
  iteration:    1 | 2 | 3
  previousIterations: { title: string; analysis: string; changes: string }[]
  userFeedback?: string
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return Response.json({ error: 'No API key' }, { status: 503 })

  const body = await req.json() as TuneRequest
  const { code, pitchSummary, iteration, previousIterations = [], userFeedback = '' } = body

  const midiToName = (m: number) => {
    const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
    return `${names[m % 12]}${Math.floor(m / 12) - 1}`
  }

  const noteList = pitchSummary.notes.map((n, i) => {
    const s = pitchSummary.noteStats?.[i]
    const statStr = s
      ? ` | variance:${s.pitchVarianceCents}¢ sustain:${Math.round(s.sustainLevel * 100)}% attack:${s.attackMs}ms`
      : ''
    return `  { start:${n.start.toFixed(2)}s end:${n.end.toFixed(2)}s midi:${n.midi}(${midiToName(n.midi)}) amp:${n.amplitude.toFixed(2)}${statStr} }`
  }).join('\n')

  const transitionList = (pitchSummary.transitions ?? []).map((t, i) => {
    const n0 = pitchSummary.notes[i], n1 = pitchSummary.notes[i + 1]
    if (!n0 || !n1) return ''
    const legato = t.gapMs < 0 ? 'LEGATO' : t.gapMs < 20 ? 'tight' : t.gapMs < 100 ? 'normal' : 'gap'
    return `  note${i}→note${i + 1}: ${legato} gap=${t.gapMs}ms jump=${t.pitchJumpSemitones > 0 ? '+' : ''}${t.pitchJumpSemitones}st`
  }).filter(Boolean).join('\n')

  const traj = pitchSummary.trajectory ?? []
  const trajectoryStr = traj.map(p =>
    `${p.t}s:${p.hz != null ? p.hz.toFixed(0) + 'Hz' : 'silence'} amp=${p.amp.toFixed(2)}`
  ).join('  ')

  const pitchRangeStr = pitchSummary.pitchRangeMidi
    ? `MIDI ${pitchSummary.pitchRangeMidi.min}–${pitchSummary.pitchRangeMidi.max} (${midiToName(pitchSummary.pitchRangeMidi.min)}–${midiToName(pitchSummary.pitchRangeMidi.max)})`
    : 'unknown'

  const medianMidi = pitchSummary.notes.length > 0
    ? pitchSummary.notes.slice().sort((a, b) => a.midi - b.midi)[Math.floor(pitchSummary.notes.length / 2)].midi
    : 60
  const medianHz = 440 * Math.pow(2, (medianMidi - 69) / 12)

  const avgVariance = pitchSummary.noteStats?.length
    ? Math.round(pitchSummary.noteStats.reduce((s, x) => s + x.pitchVarianceCents, 0) / pitchSummary.noteStats.length)
    : 0
  const expressionComment = avgVariance > 40
    ? `HIGH expression (avg ${avgVariance}¢ variance) — use stronger saturation and filter movement`
    : avgVariance > 15
    ? `MODERATE expression (avg ${avgVariance}¢ variance) — moderate saturation`
    : `LOW expression (avg ${avgVariance}¢ variance) — gentle saturation, emphasize filter character`

  const transitions = pitchSummary.transitions ?? []
  const gapCount = transitions.filter(t => t.gapMs > 30).length
  const gateComment = gapCount > 0
    ? `${gapCount} of ${transitions.length} transitions have gaps >30ms — GATE these silences`
    : 'mostly legato — gating not critical'

  const prompt = `You are a professional audio engineer improving a voice-to-synth transformation algorithm in a browser-based DAW.

This approach TRANSFORMS the original recording using Web Audio effects chains — it does NOT rebuild audio from oscillators.
The original audio's timing, dynamics, and feel are preserved; only the harmonic character is reshaped to sound synthesized.

CURRENT FUNCTION (JavaScript, will be eval()'d in Chrome):
\`\`\`js
${code}
\`\`\`

RECORDING CHARACTERISTICS:
- Duration: ${pitchSummary.totalDuration.toFixed(1)}s
- Notes detected: ${pitchSummary.noteCount}
- Average note duration: ${pitchSummary.avgDurationMs}ms
- Pitch range: ${pitchRangeStr}
- Median fundamental: MIDI ${medianMidi} = ${medianHz.toFixed(0)}Hz → suggested filter base: ${(medianHz * 3).toFixed(0)}–${(medianHz * 6).toFixed(0)}Hz
- ${expressionComment}
- ${gateComment}

NOTES WITH PER-NOTE ANALYSIS:
(variance = pitch wobble; sustain = amplitude at note end; attack = ms to 80% peak)
${noteList}

NOTE-TO-NOTE TRANSITIONS:
${transitionList || '  (no transitions — single note)'}

PITCH TRAJECTORY (downsampled ~80 pts):
${trajectoryStr}

${previousIterations.length > 0 ? `PREVIOUS PASSES (each started from original code above — do NOT chain on previous pass output):
${previousIterations.map((p, i) => `Pass ${i + 1} — ${p.title}\n  Tried: ${p.changes}\n  Result: ${p.analysis}`).join('\n')}

Write a NEW version incorporating ALL improvements from all passes simultaneously.
` : ''}${userFeedback.trim() ? `USER FEEDBACK (highest priority — address this specifically):
"${userFeedback.trim()}"

` : ''}TASK:
${ITER_TASKS[(iteration - 1)]}

Respond in EXACTLY this format — no other text before or after:

<iteration>
{
  "title": "Iteration ${iteration} — [brief descriptive title]",
  "analysis": "[3-4 sentences: what the current transformation does wrong, referencing the recording data. E.g. 'The filter Q of 2.5 is too low to produce synth character given the ${avgVariance}¢ variance — it sounds like a guitar pedal, not a Moog.' Reference specific numbers.]",
  "changes": "[1-2 sentences: exactly what you changed in the processing chain and expected sonic result]"
}
</iteration>
<code>
async function transformVoiceToSynth(originalBuf, pitchCurve, sampleRate, totalDuration, options) {
  // your improved implementation here
}
</code>

CRITICAL rules for the <code> block:
- Plain JavaScript only — NO TypeScript type annotations
- Function signature exactly: async function transformVoiceToSynth(originalBuf, pitchCurve, sampleRate, totalDuration, options)
- originalBuf is an AudioBuffer containing the original voice recording
- Helper functions available: extractNoteEvents(pitchCurve, minDuration?), midiToFreq(midi), freqToMidi(freq)
- OfflineAudioContext, AudioBufferSourceNode, WaveShaper, GainNode, BiquadFilterNode, OscillatorNode, DelayNode are browser globals
- options object has: { waveform, filterCutoff, pitchShift, followPitch, followDynamics }
- Must return Promise<AudioBuffer> via ctx.startRendering()
- Do NOT include 'export' keyword
- Use originalBuf.numberOfChannels for the OfflineAudioContext channel count
- If no notes detected, throw new Error('No pitched notes detected — try singing more clearly')

WEB AUDIO PITFALLS:
- NEVER call exponentialRampToValueAtTime(0, t) — zero is illegal; use linearRampToValueAtTime for fade-outs
- NEVER call exponentialRampToValueAtTime with a negative value
- AudioBufferSourceNode: call src.start(0) exactly once; never restart
- WaveShaper curve must be a Float32Array of length N, indexed from -1 to +1
- GainNode default value is 1.0 — always set explicitly before automation
- OscillatorNode must be started/stopped if used; osc.stop() time must be > osc.start() time`

  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type':      'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key':         apiKey,
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: 8000,
      messages:   [{ role: 'user', content: prompt }],
    }),
  })

  if (!anthropicRes.ok) {
    const err = await anthropicRes.text()
    return Response.json({ error: err }, { status: anthropicRes.status })
  }

  const data = await anthropicRes.json() as { content: { type: string; text: string }[] }
  const raw = data.content.find(b => b.type === 'text')?.text ?? ''

  const iterMatch = raw.match(/<iteration>([\s\S]*?)<\/iteration>/)
  const codeMatch = raw.match(/<code>([\s\S]*?)<\/code>/)

  if (!iterMatch || !codeMatch) {
    return Response.json({ error: 'Malformed AI response — missing <iteration> or <code> block', raw }, { status: 502 })
  }

  let iterData: { title: string; analysis: string; changes: string }
  try {
    iterData = JSON.parse(iterMatch[1].trim())
  } catch {
    return Response.json({ error: 'Could not parse iteration JSON', raw: iterMatch[1] }, { status: 502 })
  }

  const improvedCode = codeMatch[1].trim()
  return Response.json({ iteration: iterData, improvedCode })
}
