const ITER_TASKS = [
  `ITERATION 1 — Smooth Portamento & Gradual Note Transitions:
The single biggest flaw in basic synth converters is JARRING, ABRUPT note-to-note jumps — the
oscillator teleports to the new pitch in one sample, which sounds mechanical and harsh.
Real synths (Moog, Juno, DX7) glide smoothly using portamento with natural acceleration and
deceleration: the pitch curve eases OUT of the old note and eases INTO the new one.

IMPLEMENTATION RULES (do all of these):
1. Use ONE persistent oscillator that runs for the entire duration — never stop/restart it.
2. For each note-to-note transition, use exponentialRampToValueAtTime for the frequency glide.
   Portamento time = clamp(abs(pitchJumpSemitones) * 18ms, 40ms, 280ms).
   For legato (gapMs < 20): glide directly. For gaps > 20ms: drop gain to 0.05 briefly, then glide.
3. Within each note, once the target pitch is reached, hold the frequency steady
   (setValueAtTime, not a ramp) — vibrato is added in pass 2, don't add it here.
4. Gain envelope per note: attack (use attackMs from noteStats), sustain at sustainLevel,
   release using linearRampToValueAtTime (NOT exponential — zero is illegal for exponential).

USE THE TRAJECTORY DATA: Look at the hz values between notes — do they jump or glide?
Use gapMs in transitions to decide portamento speed. Negative gapMs means legato overlap.
The result should sound like a continuous singing synthesizer, not a step sequencer.`,

  `ITERATION 2 — Vibrato & Envelope Shaping:
Building on the portamento changes, now add:
1. Vibrato: an LFO (low-frequency oscillator around 5-7 Hz, depth ~0.3-0.7 semitones) modulating
   the main oscillator's frequency via a GainNode added to the frequency AudioParam. Apply it only
   after a ~150ms delay on each note (onset without wobble feels more natural).
2. Improve the amplitude envelope: use attackMs from noteStats for per-note attack time. Use
   sustainLevel from noteStats for the sustain gain target. Use pitchVarianceCents as a proxy for
   natural expressiveness — higher variance means the singer was expressive, so add more vibrato depth.
3. A proper sustain level around sustainLevel * peak, and a gentle exponentialRampToValueAtTime for
   release instead of a hard linearRamp. Reference the Juno-106 envelope shape.`,

  `ITERATION 3 — Harmonic Richness & Final Polish:
Layer the sound for warmth: add a second oscillator one octave down at 25% gain and a third
at a 5th above (1.5x frequency) at 12% gain, both sharing the same frequency automation and gain
envelope as the primary oscillator. Apply a resonant lowpass filter (Q ≈ 1.2) with the cutoff
frequency modulated slightly by an ADSR (opens wider on note attack, settles to filterCutoff).
Cross-reference with classic analog polysynth textures (Prophet-5, OB-Xa): warmth comes from
slightly detuned sub-layers, not from distortion. Ensure all timing is correct for OfflineAudioContext.
Incorporate ALL improvements from iterations 1 and 2 into this single unified rewrite.`,
]

interface NoteEvent {
  start: number; end: number; midi: number; amplitude: number
}
interface NoteStats {
  pitchVarianceCents: number  // how much pitch wobbles within the note (0 = steady, 50 = expressive vibrato)
  sustainLevel: number        // fraction of peak amplitude during the last 30% of the note (0-1)
  attackMs: number            // ms from note start to 80% of peak amplitude
}
interface Transition {
  gapMs: number               // ms of silence between this note and the next (negative = legato overlap)
  pitchJumpSemitones: number  // semitone distance (positive = up, negative = down)
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
  userFeedback?: string  // user's description of what still sounds wrong, entered between passes
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

  // Full note list with per-note stats
  const noteList = pitchSummary.notes.map((n, i) => {
    const s = pitchSummary.noteStats?.[i]
    const statStr = s
      ? ` | variance:${s.pitchVarianceCents}¢ sustain:${Math.round(s.sustainLevel * 100)}% attack:${s.attackMs}ms`
      : ''
    return `  { start:${n.start.toFixed(2)}s end:${n.end.toFixed(2)}s midi:${n.midi}(${midiToName(n.midi)}) amp:${n.amplitude.toFixed(2)}${statStr} }`
  }).join('\n')

  // Transition table
  const transitionList = (pitchSummary.transitions ?? []).map((t, i) => {
    const n0 = pitchSummary.notes[i], n1 = pitchSummary.notes[i + 1]
    if (!n0 || !n1) return ''
    const dir = t.pitchJumpSemitones > 0 ? '↑' : t.pitchJumpSemitones < 0 ? '↓' : '→'
    const legato = t.gapMs < 0 ? 'LEGATO' : t.gapMs < 20 ? 'tight' : t.gapMs < 100 ? 'normal' : 'gap'
    return `  note${i}→note${i + 1}: ${legato} gap=${t.gapMs}ms jump=${t.pitchJumpSemitones > 0 ? '+' : ''}${t.pitchJumpSemitones}st ${dir}`
  }).filter(Boolean).join('\n')

  // Pitch trajectory as compact table (every point)
  const traj = (pitchSummary.trajectory ?? [])
  const trajectoryStr = traj.map(p =>
    `${p.t}s:${p.hz != null ? p.hz.toFixed(0) + 'Hz' : 'silence'} amp=${p.amp.toFixed(2)}`
  ).join('  ')

  const pitchRangeStr = pitchSummary.pitchRangeMidi
    ? `MIDI ${pitchSummary.pitchRangeMidi.min}–${pitchSummary.pitchRangeMidi.max} (${midiToName(pitchSummary.pitchRangeMidi.min)}–${midiToName(pitchSummary.pitchRangeMidi.max)})`
    : 'unknown'

  // Summarize vibrato presence from note stats
  const avgVariance = pitchSummary.noteStats?.length
    ? Math.round(pitchSummary.noteStats.reduce((s, x) => s + x.pitchVarianceCents, 0) / pitchSummary.noteStats.length)
    : 0
  const vibratoComment = avgVariance > 40
    ? `HIGH pitch variance (avg ${avgVariance}¢) — singer uses significant vibrato/expression`
    : avgVariance > 15
    ? `MODERATE pitch variance (avg ${avgVariance}¢) — some natural vibrato present`
    : `LOW pitch variance (avg ${avgVariance}¢) — relatively straight tones`

  // Transition style summary
  const transitions = pitchSummary.transitions ?? []
  const legatoCount = transitions.filter(t => t.gapMs < 20).length
  const gapCount    = transitions.filter(t => t.gapMs > 80).length
  const transitionStyle = transitions.length === 0 ? 'no transitions'
    : legatoCount > transitions.length * 0.6 ? 'mostly LEGATO — use portamento with minimal gain dip'
    : gapCount    > transitions.length * 0.6 ? 'mostly STACCATO — brief silence gaps between notes'
    : 'mixed legato/staccato'

  const prompt = `You are a professional synthesizer engineer improving a voice-to-synth algorithm in a browser-based DAW.

CURRENT FUNCTION (JavaScript, will be eval()'d in Chrome):
\`\`\`js
${code}
\`\`\`

RECORDING CHARACTERISTICS:
- Duration: ${pitchSummary.totalDuration.toFixed(1)}s
- Notes detected: ${pitchSummary.noteCount}
- Average note duration: ${pitchSummary.avgDurationMs}ms
- Pitch range: ${pitchRangeStr}
- ${vibratoComment}
- Transition style: ${transitionStyle}

NOTES WITH PER-NOTE ANALYSIS:
(variance = pitch wobble in cents within note; sustain = amplitude fraction at end; attack = ms to reach 80% peak)
${noteList}

NOTE-TO-NOTE TRANSITIONS:
${transitionList || '  (no transitions — single note recording)'}

PITCH TRAJECTORY (downsampled to ~80 points — use this to see actual glides, vibrato shape, silence gaps):
${trajectoryStr}

${previousIterations.length > 0 ? `PREVIOUS PASSES (applied to the SAME original code above, not chained):
${previousIterations.map((p, i) => `Pass ${i + 1} — ${p.title}\n  Tried: ${p.changes}\n  Result: ${p.analysis}`).join('\n')}

Each pass starts fresh from the original code shown above — do NOT build on the previous pass's output code. Instead, write a NEW version of the function that incorporates ALL improvements from all passes simultaneously, avoiding any mistakes noted above.
` : ''}${userFeedback.trim() ? `USER FEEDBACK (listened to the last result and reported):
"${userFeedback.trim()}"
This is the highest-priority input — address this specific complaint in the code you write. Treat it as the primary goal of this pass, in addition to the technical task below.

` : ''}TASK:
${ITER_TASKS[(iteration - 1)]}

Respond in EXACTLY this format — no other text before or after:

<iteration>
{
  "title": "Iteration ${iteration} — [brief descriptive title]",
  "analysis": "[3-4 sentences: what sounds wrong now and why, referencing specific synthesis/music theory concepts. Reference specific numbers from the trajectory/stats above — e.g. 'the 45¢ pitch variance indicates active vibrato' or 'the 8ms gaps suggest legato phrasing']",
  "changes": "[1-2 sentences: exactly what you changed and the expected sonic result]"
}
</iteration>
<code>
async function synthesizeFromPitchCurve(pitchCurve, sampleRate, _rootNote, totalDuration, options) {
  // your improved implementation here
}
</code>

CRITICAL rules for the <code> block:
- Plain JavaScript only — NO TypeScript type annotations
- Function signature exactly: async function synthesizeFromPitchCurve(pitchCurve, sampleRate, _rootNote, totalDuration, options)
- Helper functions available as parameters: extractNoteEvents(pitchCurve, minDuration?), midiToFreq(midi), freqToMidi(freq)
- OfflineAudioContext, OscillatorNode, GainNode, BiquadFilterNode etc. are browser globals
- options object has: { waveform, filterCutoff, pitchShift, followPitch, followDynamics }
- Must return Promise<AudioBuffer> via ctx.startRendering()
- Do NOT include 'export' keyword
- If no notes detected, throw new Error('No pitched notes detected — try singing more clearly')

WEB AUDIO PITFALLS — avoid these or the output will be silent/broken:
- NEVER call exponentialRampToValueAtTime(0, t) — zero is illegal for exponential ramps; use linearRampToValueAtTime(0, t) for fade-outs
- NEVER call exponentialRampToValueAtTime with a negative value
- Always call osc.start() and osc.stop() — an oscillator that is never started produces silence
- osc.stop() time must be > osc.start() time; if dur is tiny, use Math.max(0.05, dur)
- For portamento: automate frequency with setValueAtTime then exponentialRampToValueAtTime between POSITIVE frequency values only
- GainNode default value is 1.0 — always set gain explicitly before automation`

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
