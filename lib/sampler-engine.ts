/**
 * Core sampler synthesis engine for BeatLab.
 * Handles sample loading, pitch transposition, looping, and ADSR playback.
 */

export interface SamplerKeyGroup {
  id: string
  sampleUrl: string      // object URL, data URL, or 'builtin:<type>'
  rootNote: number       // MIDI note (60 = C4)
  loNote: number         // lowest note this group plays (0-127)
  hiNote: number         // highest note (0-127)
  loVel: number          // velocity range low (0-127)
  hiVel: number          // velocity range high (0-127)
  loopStart: number      // loop start in seconds (0 = disabled)
  loopEnd: number        // loop end in seconds (0 = disabled)
  tune: number           // fine tune in cents (-100 to +100)
  gain: number           // volume multiplier (0-2)
}

export interface SamplerPatch {
  id: string
  name: string
  keyGroups: SamplerKeyGroup[]
  attack: number         // seconds (0-2)
  decay: number          // seconds (0-2)
  sustain: number        // 0-1
  release: number        // seconds (0-4)
  filterCutoff: number   // Hz (20-20000)
  filterResonance: number // Q value (0-30)
}

export const DEFAULT_SAMPLER_PATCH: SamplerPatch = {
  id: 'default',
  name: 'Untitled Patch',
  keyGroups: [],
  attack: 0.005,
  decay: 0.1,
  sustain: 0.8,
  release: 0.4,
  filterCutoff: 18000,
  filterResonance: 0,
}

/**
 * Decode an audio Blob into an AudioBuffer using a temporary AudioContext.
 */
export async function loadSampleBuffer(blob: Blob): Promise<AudioBuffer> {
  const arrayBuffer = await blob.arrayBuffer()
  const ctx = new AudioContext()
  try {
    return await ctx.decodeAudioData(arrayBuffer.slice(0))
  } finally {
    void ctx.close()
  }
}

/**
 * Find the best matching key group for a MIDI note + velocity.
 * If multiple groups overlap, prefer the one whose rootNote is closest.
 */
function findKeyGroup(
  patch: SamplerPatch,
  buffers: Map<string, AudioBuffer>,
  midiNote: number,
  velocity: number,
): SamplerKeyGroup | null {
  const vel127 = velocity * 127
  const candidates = patch.keyGroups.filter(kg =>
    midiNote >= kg.loNote &&
    midiNote <= kg.hiNote &&
    vel127 >= kg.loVel &&
    vel127 <= kg.hiVel &&
    buffers.has(kg.id)
  )
  if (candidates.length === 0) return null
  candidates.sort((a, b) =>
    Math.abs(a.rootNote - midiNote) - Math.abs(b.rootNote - midiNote)
  )
  return candidates[0]
}

/**
 * Play a MIDI note through the sampler.
 * Returns a stop function that triggers the release phase.
 * velocity is 0–1.
 */
export function playSamplerNote(
  ctx: AudioContext,
  patch: SamplerPatch,
  buffers: Map<string, AudioBuffer>,
  midiNote: number,
  velocity: number,
  startTime: number,
  destination: AudioNode = ctx.destination,
): () => void {
  const kg = findKeyGroup(patch, buffers, midiNote, velocity)
  if (!kg) return () => {}

  const buffer = buffers.get(kg.id)
  if (!buffer) return () => {}

  // Signal chain: source → envelope → filter → destination
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = Math.max(20, Math.min(20000, patch.filterCutoff))
  filter.Q.value = Math.max(0, Math.min(30, patch.filterResonance))
  filter.connect(destination)

  const envGain = ctx.createGain()
  envGain.connect(filter)

  const peakGain = Math.max(0.0001, kg.gain * velocity)
  const sustainGain = Math.max(0.0001, peakGain * patch.sustain)
  const attackDur = Math.max(0.001, patch.attack)
  const decayDur = Math.max(0.001, patch.decay)
  const attackEnd = startTime + attackDur
  const decayEnd = attackEnd + decayDur

  envGain.gain.setValueAtTime(0.0001, startTime)
  envGain.gain.exponentialRampToValueAtTime(peakGain, attackEnd)
  envGain.gain.exponentialRampToValueAtTime(sustainGain, decayEnd)

  const src = ctx.createBufferSource()
  src.buffer = buffer

  // Pitch transposition: semitones = note interval + fine tune (cents → semitones)
  const semitones = (midiNote - kg.rootNote) + (kg.tune / 100)
  src.playbackRate.value = Math.pow(2, semitones / 12)

  // Loop
  if (kg.loopEnd > kg.loopStart && kg.loopEnd > 0) {
    src.loop = true
    src.loopStart = Math.max(0, kg.loopStart)
    src.loopEnd = Math.min(kg.loopEnd, buffer.duration)
  }

  src.connect(envGain)
  src.start(startTime)

  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    const now = ctx.currentTime
    const releaseDur = Math.max(0.01, patch.release)
    envGain.gain.cancelScheduledValues(now)
    envGain.gain.setValueAtTime(sustainGain, now)
    envGain.gain.exponentialRampToValueAtTime(0.0001, now + releaseDur)
    src.stop(now + releaseDur + 0.05)
  }
}
