// Interleaved 16-bit PCM WAV encoder — universally playable in <audio>. Shared by
// the real-mix bounce (32-bit float → 16-bit) and by section slicing (extracting
// a window out of the already-rendered full-song buffer).
export function encodeWav16(channels: Float32Array[], sampleRate: number): ArrayBuffer {
  const numCh = channels.length || 1
  const numFrames = channels[0]?.length ?? 0
  const blockAlign = numCh * 2
  const dataLen = numFrames * blockAlign
  const buf = new ArrayBuffer(44 + dataLen)
  const dv = new DataView(buf)
  const ws = (off: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)) }
  ws(0, 'RIFF'); dv.setUint32(4, 36 + dataLen, true); ws(8, 'WAVE')
  ws(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, numCh, true)
  dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * blockAlign, true)
  dv.setUint16(32, blockAlign, true); dv.setUint16(34, 16, true)
  ws(36, 'data'); dv.setUint32(40, dataLen, true)
  let off = 44
  for (let f = 0; f < numFrames; f++) {
    for (let ch = 0; ch < numCh; ch++) {
      let v = channels[ch][f]; v = v < -1 ? -1 : v > 1 ? 1 : v
      dv.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true); off += 2
    }
  }
  return buf
}
