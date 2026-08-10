// Audio → MIDI, the shared LOCAL hybrid. One implementation consumed by the "Audio to MIDI" app
// (components/apps/Transcribe) and Firefly's file-upload path — so both get the same behaviour:
//   • monophonic YIN/HMM pass transcribes the melody line (lib/voice-backfill),
//   • each note is scored (lib/transcribe-confidence); low-confidence POLYPHONIC notes are expanded
//     into their chord tones by the local multi-f0 detector (lib/poly-detect),
//   • chord spans the mono pass DROPPED entirely are recovered from sounding gaps.
// Fully local — no AI, no network. Returns notes on the seconds timeline (RecNote-shaped).
import { analyzeBufferAsync, type FeatureFrame } from './voice-backfill'
import { scoreNotes } from './transcribe-confidence'
import { detectPolyphony, findUncoveredChords } from './poly-detect'

export interface AudioNote { startSec: number; midi: number; durSec: number; velocity: number; confidence: number }
export interface AudioToMidiResult {
  notes: AudioNote[]
  chordsResolved: number   // how many chords the hybrid recovered locally
  lowConfidence: number    // notes still uncertain after the local pass (unclear audio → hand-edit)
}

export async function audioToNotes(
  samples: Float32Array, sr: number, opts: { sensitivity?: number } = {},
): Promise<AudioToMidiResult> {
  const a = await analyzeBufferAsync(samples, sr, { sensitivity: opts.sensitivity ?? 0.5, minDuration: 0.08, segmenter: 'hmm' })
  const curve = (a.curve || []) as FeatureFrame[]
  const scores = scoreNotes(a.notes, curve, samples, sr)
  const notes: AudioNote[] = []
  let chordsResolved = 0, lowConfidence = 0
  a.notes.forEach((n, i) => {
    const sc = scores[i]
    if (sc.polyphonic && sc.confidence < 0.55) {
      const chord = detectPolyphony(samples, sr, n.startSec, n.durSec)
      if (chord.length >= 2) {
        chordsResolved++
        for (const midi of chord) notes.push({ startSec: n.startSec, midi, durSec: n.durSec, velocity: n.velocity, confidence: 0.85 })
        return
      }
    }
    if (sc.confidence < 0.55) lowConfidence++
    notes.push({ startSec: n.startSec, midi: n.midi, durSec: n.durSec, velocity: n.velocity, confidence: sc.confidence })
  })
  // Recover chords the mono pass dropped entirely (sounding audio covered by no mono note).
  for (const gc of findUncoveredChords(samples, sr, a.notes, curve, { minDuration: 0.12 })) {
    chordsResolved++
    for (const midi of gc.midis) notes.push({ startSec: gc.startSec, midi, durSec: gc.durSec, velocity: 0.7, confidence: 0.8 })
  }
  notes.sort((x, y) => x.startSec - y.startSec || x.midi - y.midi)
  return { notes, chordsResolved, lowConfidence }
}
