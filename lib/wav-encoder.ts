'use client'

// The 16-bit WAV surface. The encoder itself lives in lib/wav-codec, which owns
// both depths — this file exists because seven modules already import
// audioBufferToWav from here, and the point of consolidating was to remove the
// duplicate implementation, not to churn every call site.

import { audioBufferToWavBlob } from './wav-codec'

/** Encodes an AudioBuffer to a 16-bit PCM WAV Blob. */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  return audioBufferToWavBlob(buffer)
}

export async function blobToAudioBuffer(blob: Blob): Promise<AudioBuffer> {
  const ctx = new AudioContext()
  try {
    return await ctx.decodeAudioData(await blob.arrayBuffer())
  } finally {
    void ctx.close()
  }
}

/**
 * Converts a WebM/Opus blob to WAV by decoding through the Web Audio API.
 * Lossy: Opus is decoded to PCM, then re-encoded as WAV.
 */
export async function convertBlobToWav(blob: Blob): Promise<Blob> {
  return audioBufferToWav(await blobToAudioBuffer(blob))
}
