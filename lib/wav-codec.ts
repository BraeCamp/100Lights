// WAV encode / decode for API transport.
// Supports 16-bit PCM decode (common from Ableton exports) and
// 32-bit IEEE float decode/encode (lossless, used for API responses).

const TEXT = new TextEncoder()

function tag(s: string): Uint8Array { return TEXT.encode(s) }

function u16le(n: number): Uint8Array {
  const b = new Uint8Array(2); b[0] = n & 0xff; b[1] = (n >> 8) & 0xff; return b
}
function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4)
  b[0] = n & 0xff; b[1] = (n >> 8) & 0xff; b[2] = (n >> 16) & 0xff; b[3] = (n >> 24) & 0xff
  return b
}

/** Encode interleaved Float32Array channels as 32-bit IEEE float WAV */
export function encodeWav(channels: Float32Array[], sampleRate: number): ArrayBuffer {
  const numCh    = channels.length
  const numSamps = channels[0].length
  const bps      = 32
  const byteSamp = bps / 8
  const dataSize = numSamps * numCh * byteSamp

  const buf = new ArrayBuffer(44 + dataSize)
  const dv  = new DataView(buf)
  let off = 0

  const write = (bytes: Uint8Array) => { new Uint8Array(buf, off, bytes.length).set(bytes); off += bytes.length }
  write(tag('RIFF')); write(u32le(36 + dataSize)); write(tag('WAVE'))
  write(tag('fmt ')); write(u32le(16))
  write(u16le(3))                                     // IEEE float
  write(u16le(numCh)); write(u32le(sampleRate))
  write(u32le(sampleRate * numCh * byteSamp))          // byte rate
  write(u16le(numCh * byteSamp))                       // block align
  write(u16le(bps))
  write(tag('data')); write(u32le(dataSize))

  // Interleave channels
  for (let s = 0; s < numSamps; s++) {
    for (let ch = 0; ch < numCh; ch++) {
      dv.setFloat32(off, channels[ch][s], true); off += 4
    }
  }
  return buf
}

export interface DecodedWav {
  channels: Float32Array[]
  sampleRate: number
}

/** Decode a WAV ArrayBuffer into Float32Array channels */
export function decodeWav(ab: ArrayBuffer): DecodedWav {
  const dv = new DataView(ab)
  const readStr = (off: number, len: number) =>
    String.fromCharCode(...new Uint8Array(ab, off, len))

  if (readStr(0, 4) !== 'RIFF' || readStr(8, 4) !== 'WAVE') throw new Error('Not a WAV file')

  // Find fmt and data chunks (WAV can have extra chunks before data)
  let fmtOff = -1, dataOff = -1, dataLen = -1
  let cursor = 12
  while (cursor + 8 <= dv.byteLength) {
    const id   = readStr(cursor, 4)
    const size = dv.getUint32(cursor + 4, true)
    if (id === 'fmt ')  fmtOff = cursor + 8
    if (id === 'data') { dataOff = cursor + 8; dataLen = size }
    cursor += 8 + size
  }
  if (fmtOff < 0 || dataOff < 0) throw new Error('Malformed WAV: missing fmt or data chunk')

  const audioFmt = dv.getUint16(fmtOff,     true)
  const numCh    = dv.getUint16(fmtOff + 2, true)
  const sr       = dv.getUint32(fmtOff + 4, true)
  const bps      = dv.getUint16(fmtOff + 14, true)

  const byteSamp   = bps / 8
  const numFrames  = Math.floor(dataLen / (numCh * byteSamp))
  const channels   = Array.from({ length: numCh }, () => new Float32Array(numFrames))

  for (let s = 0; s < numFrames; s++) {
    for (let ch = 0; ch < numCh; ch++) {
      const pos = dataOff + (s * numCh + ch) * byteSamp
      if (audioFmt === 3 && bps === 32) {
        channels[ch][s] = dv.getFloat32(pos, true)
      } else if (audioFmt === 1 && bps === 16) {
        channels[ch][s] = dv.getInt16(pos, true) / 32768
      } else if (audioFmt === 1 && bps === 24) {
        const lo = dv.getUint8(pos), mi = dv.getUint8(pos + 1), hi = dv.getInt8(pos + 2)
        channels[ch][s] = ((hi << 16) | (mi << 8) | lo) / 8388608
      } else if (audioFmt === 1 && bps === 32) {
        channels[ch][s] = dv.getInt32(pos, true) / 2147483648
      } else {
        throw new Error(`Unsupported WAV format: fmt=${audioFmt}, bps=${bps}`)
      }
    }
  }

  return { channels, sampleRate: sr }
}
