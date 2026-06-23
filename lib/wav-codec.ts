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

// ── AIFF / AIFC decoder ────────────────────────────────────────────────────
// Chrome's Web Audio API does not support AIFF natively; this handles it
// manually. Supports AIFF (big-endian PCM) and AIFC compression types:
//   NONE / twos = big-endian PCM  |  sowt = little-endian PCM
//   fl32 / FL32 = 32-bit float    |  8-bit unsigned PCM

// 80-bit IEEE 754 extended precision → number (used for AIFF sample rate field)
function readFloat80(dv: DataView, off: number): number {
  const exp = ((dv.getUint8(off) & 0x7F) << 8) | dv.getUint8(off + 1)
  const hi  = dv.getUint32(off + 2, false)
  const lo  = dv.getUint32(off + 6, false)
  if (exp === 0 && hi === 0 && lo === 0) return 0
  if (exp === 0x7FFF) return Infinity
  return (hi * Math.pow(2, -31) + lo * Math.pow(2, -63)) * Math.pow(2, exp - 16383)
}

export function decodeAiff(ab: ArrayBuffer): DecodedWav {
  const dv      = new DataView(ab)
  const readStr = (o: number, n: number) => String.fromCharCode(...new Uint8Array(ab, o, n))

  if (readStr(0, 4) !== 'FORM') throw new Error('Not an AIFF file')
  const formType = readStr(8, 4)
  if (formType !== 'AIFF' && formType !== 'AIFC') throw new Error(`Not AIFF/AIFC (got ${formType})`)
  const isAIFC = formType === 'AIFC'

  // Walk chunks
  let commOff = -1, ssndOff = -1, ssndSize = 0
  let cursor = 12
  while (cursor + 8 <= dv.byteLength) {
    const id   = readStr(cursor, 4)
    const size = dv.getInt32(cursor + 4, false)  // big-endian chunk size
    if (id === 'COMM') commOff = cursor + 8
    if (id === 'SSND') { ssndOff = cursor + 8; ssndSize = size }
    cursor += 8 + size + (size & 1)  // chunks are padded to even byte boundary
  }
  if (commOff < 0) throw new Error('AIFF: missing COMM chunk')
  if (ssndOff < 0) throw new Error('AIFF: missing SSND chunk')

  const numChannels = dv.getInt16(commOff,     false)
  const numFrames   = dv.getUint32(commOff + 2, false)
  const sampleSize  = dv.getInt16(commOff + 6, false)
  const sampleRate  = readFloat80(dv, commOff + 8)
  const compression = isAIFC ? readStr(commOff + 18, 4) : 'NONE'

  // SSND chunk: 4-byte offset + 4-byte blockSize then raw audio
  const audioSkip  = dv.getUint32(ssndOff, false)
  const audioStart = ssndOff + 8 + audioSkip
  const byteSamp   = Math.ceil(sampleSize / 8)

  const channels = Array.from({ length: numChannels }, () => new Float32Array(numFrames))

  for (let s = 0; s < numFrames; s++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const pos = audioStart + (s * numChannels + ch) * byteSamp
      let sample = 0

      if (compression === 'NONE' || compression === 'twos') {
        // Big-endian PCM
        if (sampleSize === 8) {
          sample = (dv.getUint8(pos) - 128) / 128
        } else if (sampleSize === 16) {
          sample = dv.getInt16(pos, false) / 32768
        } else if (sampleSize === 24) {
          const raw = (dv.getUint8(pos) << 16) | (dv.getUint8(pos + 1) << 8) | dv.getUint8(pos + 2)
          sample = (raw >= 0x800000 ? raw - 0x1000000 : raw) / 8388608
        } else if (sampleSize === 32) {
          sample = dv.getInt32(pos, false) / 2147483648
        }
      } else if (compression === 'sowt') {
        // Little-endian PCM (some AIFC files use this)
        if (sampleSize === 16) {
          sample = dv.getInt16(pos, true) / 32768
        } else if (sampleSize === 24) {
          const lo = dv.getUint8(pos), mi = dv.getUint8(pos + 1), hi = dv.getInt8(pos + 2)
          sample = ((hi << 16) | (mi << 8) | lo) / 8388608
        } else if (sampleSize === 32) {
          sample = dv.getInt32(pos, true) / 2147483648
        }
      } else if (compression === 'fl32' || compression === 'FL32') {
        sample = dv.getFloat32(pos, false)  // big-endian float
      } else {
        throw new Error(`Unsupported AIFC compression type: "${compression}"`)
      }

      channels[ch][s] = sample
    }
  }

  return { channels, sampleRate }
}

// Detect format by magic bytes and route to the right decoder.
// Use this in server-side API routes where the file type isn't guaranteed.
export function decodeAudioAny(ab: ArrayBuffer): DecodedWav {
  if (ab.byteLength < 12) throw new Error('File too small to identify')
  const bytes = new Uint8Array(ab, 0, 12)
  const isAiff =
    bytes[0] === 0x46 && bytes[1] === 0x4F && bytes[2] === 0x52 && bytes[3] === 0x4D &&  // FORM
    (bytes[8] === 0x41 && bytes[9] === 0x49)   // AI (AIFF or AIFC)
  return isAiff ? decodeAiff(ab) : decodeWav(ab)
}
