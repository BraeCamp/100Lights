const ITER_TASKS = [
  `ITERATION 1 — Portamento & Legato Transitions:
The most common flaw in basic synth converters is abrupt note-to-note jumps because each note
spawns a fresh oscillator at a fixed frequency. Real synths (Moog, Juno, DX7) use portamento:
the oscillator frequency glides continuously from the previous note to the next using
exponentialRampToValueAtTime. Use a SINGLE shared oscillator whose frequency is automated across
all notes, with a gain envelope that shapes each note onset and release. Silence gaps between notes
should briefly fade the gain rather than stop/restart the oscillator.`,

  `ITERATION 2 — Vibrato & Envelope Shaping:
Building on the portamento changes, now add:
1. Vibrato: an LFO (low-frequency oscillator around 5-7 Hz, depth ~0.3-0.7 semitones) modulating
   the main oscillator's frequency via a GainNode added to the frequency AudioParam. Apply it only
   after a ~150ms delay on each note (onset without wobble feels more natural).
2. Improve the amplitude envelope: longer attack on sustained notes (>400ms), a proper sustain
   level around 65-75% of peak, and a gentle exponentialRampToValueAtTime for release instead of
   a hard linearRamp. Reference the Juno-106 envelope shape.`,

  `ITERATION 3 — Harmonic Richness & Final Polish:
Layer the sound for warmth: add a second oscillator one octave down at 25% gain and a third
at a 5th above (1.5x frequency) at 12% gain, both sharing the same frequency automation and gain
envelope as the primary oscillator. Apply a resonant lowpass filter (Q ≈ 1.2) with the cutoff
frequency modulated slightly by an ADSR (opens wider on note attack, settles to filterCutoff).
Cross-reference with classic analog polysynth textures (Prophet-5, OB-Xa): warmth comes from
slightly detuned sub-layers, not from distortion. Ensure all timing is correct for OfflineAudioContext.`,
]

interface TuneRequest {
  code:         string                                   // current JS function source
  pitchSummary: {
    totalDuration: number
    noteCount:     number
    avgDurationMs: number
    pitchRangeMidi: { min: number; max: number } | null
    notes: { start: number; end: number; midi: number; amplitude: number }[]
  }
  iteration:    1 | 2 | 3
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return Response.json({ error: 'No API key' }, { status: 503 })

  const body = await req.json() as TuneRequest
  const { code, pitchSummary, iteration } = body

  const midiToName = (m: number) => {
    const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
    return `${names[m % 12]}${Math.floor(m / 12) - 1}`
  }

  const noteList = pitchSummary.notes.slice(0, 12).map(n =>
    `  { start: ${n.start.toFixed(2)}s, end: ${n.end.toFixed(2)}s, midi: ${n.midi} (${midiToName(n.midi)}), amp: ${n.amplitude.toFixed(2)} }`
  ).join('\n')

  const pitchRangeStr = pitchSummary.pitchRangeMidi
    ? `MIDI ${pitchSummary.pitchRangeMidi.min}–${pitchSummary.pitchRangeMidi.max} (${midiToName(pitchSummary.pitchRangeMidi.min)}–${midiToName(pitchSummary.pitchRangeMidi.max)})`
    : 'unknown'

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
- Sample notes:
${noteList}

TASK:
${ITER_TASKS[(iteration - 1)]}

Respond in EXACTLY this format — no other text before or after:

<iteration>
{
  "title": "Iteration ${iteration} — [brief descriptive title]",
  "analysis": "[3-4 sentences: what sounds wrong now and why, referencing specific synthesis/music theory concepts]",
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
- options object has: { waveform, filterCutoff, pitchShift, followPitch, followDynamics, portamento, vibrato }
- Must return Promise<AudioBuffer> via ctx.startRendering()
- Do NOT include 'export' keyword
- If no notes detected, throw new Error('No pitched notes detected — try singing more clearly')`

  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type':      'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key':         apiKey,
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: 4096,
      messages:   [{ role: 'user', content: prompt }],
    }),
  })

  if (!anthropicRes.ok) {
    const err = await anthropicRes.text()
    return Response.json({ error: err }, { status: anthropicRes.status })
  }

  const data = await anthropicRes.json() as { content: { type: string; text: string }[] }
  const raw = data.content.find(b => b.type === 'text')?.text ?? ''

  // Extract <iteration> JSON and <code> blocks separately — avoids JSON escaping
  // issues when the code contains quotes, backticks, or newlines.
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
