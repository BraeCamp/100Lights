'use client'

/**
 * Encodes an AudioBuffer to a 16-bit PCM WAV Blob.
 * No external dependencies required.
 */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels    = buffer.numberOfChannels
  const sampleRate     = buffer.sampleRate
  const numSamples     = buffer.length
  const bytesPerSample = 2  // 16-bit
  const blockAlign     = numChannels * bytesPerSample
  const byteRate       = sampleRate * blockAlign
  const dataSize       = numSamples * blockAlign
  const totalSize      = 44 + dataSize

  const arrayBuffer = new ArrayBuffer(totalSize)
  const view        = new DataView(arrayBuffer)

  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(view, 8, 'WAVE')

  // fmt sub-chunk
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)         // subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true)          // audioFormat (PCM = 1)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)         // bitsPerSample

  // data sub-chunk
  writeString(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  // Interleave channels and write 16-bit samples
  let offset = 44
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const channelData = buffer.getChannelData(ch)
      const sample = Math.max(-1, Math.min(1, channelData[i]))
      const int16  = sample < 0 ? sample * 0x8000 : sample * 0x7FFF
      view.setInt16(offset, int16, true)
      offset += 2
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' })
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i))
  }
}

/**
 * Decodes any audio blob (WebM, MP3, etc.) to an AudioBuffer via Web Audio API.
 */
export async function blobToAudioBuffer(blob: Blob): Promise<AudioBuffer> {
  const ctx = new AudioContext()
  try {
    const arrayBuffer = await blob.arrayBuffer()
    return await ctx.decodeAudioData(arrayBuffer)
  } finally {
    void ctx.close()
  }
}

/**
 * Converts a WebM/Opus blob to WAV by decoding through Web Audio API.
 * This is lossy (Opus is decoded to PCM, then re-encoded as WAV).
 */
export async function convertBlobToWav(blob: Blob): Promise<Blob> {
  const audioBuffer = await blobToAudioBuffer(blob)
  return audioBufferToWav(audioBuffer)
}
