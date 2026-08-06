import { ArrayBufferTarget, Muxer } from 'mp4-muxer'
import { encodeWav16 } from './wav16'

// Encode mixed float channels to a SMALL compressed file when WebCodecs
// AudioEncoder is available (AAC in an MP4/.m4a container — decodes in every
// target browser — falling back to Opus), else 16-bit WAV. A 4-minute song is
// ~4-6 MB as AAC vs ~40 MB as WAV, so the linked-mix upload is ~8-10× smaller
// and correspondingly faster. Returns the blob plus the file extension + MIME so
// callers can name and presign it correctly.
export async function encodeMix(
  channels: Float32Array[],
  sampleRate: number,
): Promise<{ blob: Blob; ext: string; mime: string }> {
  const numCh = Math.min(2, Math.max(1, channels.length))
  const hasWebCodecs = typeof AudioEncoder !== 'undefined' && typeof AudioData !== 'undefined'
  if (hasWebCodecs && channels[0]?.length) {
    // AAC-in-MP4 only: it decodes in every target browser (Chrome/Edge/Safari),
    // unlike Opus-in-MP4 (Safari can't decode it). Browsers without an AAC
    // encoder (some Firefox builds) fall through to the correct WAV below.
    try {
      const support = await AudioEncoder.isConfigSupported({
        codec: 'mp4a.40.2', sampleRate, numberOfChannels: numCh, bitrate: 160_000,
      })
      if (support?.supported) {
        const blob = await muxCompressed(channels, sampleRate, numCh, 'aac', 'mp4a.40.2')
        if (blob && blob.size > 0) return { blob, ext: '.m4a', mime: 'audio/mp4' }
      }
    } catch { /* fall through to WAV */ }
  }
  // Fallback: uncompressed 16-bit WAV (always works, just large).
  return {
    blob: new Blob([encodeWav16(channels, sampleRate)], { type: 'audio/wav' }),
    ext: '.wav',
    mime: 'audio/wav',
  }
}

async function muxCompressed(
  channels: Float32Array[],
  sampleRate: number,
  numCh: number,
  muxCodec: 'aac' | 'opus',
  encCodec: string,
): Promise<Blob | null> {
  const target = new ArrayBufferTarget()
  const muxer = new Muxer({
    target,
    audio: { codec: muxCodec, numberOfChannels: numCh, sampleRate },
    fastStart: 'in-memory',
  })
  let encErr: Error | null = null
  const encoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (e) => { encErr = e as Error },
  })
  encoder.configure({ codec: encCodec, sampleRate, numberOfChannels: numCh, bitrate: 160_000 })

  const ch0 = channels[0]
  const ch1 = numCh > 1 ? (channels[1] ?? ch0) : ch0
  const total = ch0.length
  const CHUNK = 4096
  try {
    for (let s = 0; s < total; s += CHUNK) {
      const n = Math.min(CHUNK, total - s)
      // Planar layout: channel 0 samples, then channel 1 samples.
      const data = new Float32Array(n * numCh)
      data.set(ch0.subarray(s, s + n), 0)
      if (numCh > 1) data.set(ch1.subarray(s, s + n), n)
      const ad = new AudioData({
        format: 'f32-planar',
        sampleRate,
        numberOfFrames: n,
        numberOfChannels: numCh,
        timestamp: Math.round((s / sampleRate) * 1e6),
        data,
      })
      encoder.encode(ad)
      ad.close()   // release the backing store immediately (encode has copied it)
    }
    await encoder.flush()
  } finally {
    // Always close the encoder — even if flush()/encode() threw — so it never
    // leaks a system audio-encoder resource on the WAV-fallback path.
    try { encoder.close() } catch { /* already closed */ }
  }
  if (encErr) return null
  muxer.finalize()
  return new Blob([target.buffer], { type: 'audio/mp4' })
}
