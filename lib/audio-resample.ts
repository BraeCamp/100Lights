// Retune a buffer offline by a number of semitones.
//
// This existed twice inside default-samples, and the two copies disagreed: one
// sized the render at duration/rate, the other at the source duration. The
// second is wrong in one direction — pitching DOWN slows playback, so the
// result is LONGER than the source, and a buffer sized to the source silently
// cuts the tail off every note rendered below its nearest sample. Exactly the
// kind of thing that survives for ages because it only affects some notes and
// only at the end.

/** Playback rate for a semitone offset: >1 speeds up (higher), <1 slows down. */
export function rateForSemitones(semitones: number): number {
  return Math.pow(2, semitones / 12)
}

/**
 * Render `buffer` shifted by `semitones`, at the correct length.
 *
 * Pitch, duration and formants move together — this is playback-rate
 * resampling, the same thing a sampler does when a note is played away from a
 * zone's root. Small intervals are transparent; large ones are not, which is
 * why sampled instruments keep several roots rather than one.
 */
export async function resampleBySemitones(
  buffer: AudioBuffer,
  semitones: number,
  opts: { sampleRate?: number; channels?: number } = {},
): Promise<AudioBuffer> {
  const sr = opts.sampleRate ?? 44100
  const channels = opts.channels ?? Math.max(1, buffer.numberOfChannels)
  const rate = rateForSemitones(semitones)
  // Length follows the RATE, not the source: slowing down needs more room.
  const frames = Math.max(1, Math.ceil((buffer.duration / rate) * sr))
  const ctx = new OfflineAudioContext(channels, frames, sr)
  const src = ctx.createBufferSource()
  src.buffer = buffer
  if (semitones !== 0) src.detune.value = semitones * 100
  src.connect(ctx.destination)
  src.start(0)
  return ctx.startRendering()
}
