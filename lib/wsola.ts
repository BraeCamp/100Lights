// WSOLA (Waveform Similarity Overlap-Add) time stretching.
// Stretches an AudioBuffer by stretchFactor without changing pitch.
// stretchFactor > 1 = slower, < 1 = faster.
export function wsola(buf: AudioBuffer, stretchFactor: number): AudioBuffer {
  if (Math.abs(stretchFactor - 1) < 0.002) return buf

  const sr        = buf.sampleRate
  const winSize   = Math.max(64, Math.round(sr * 0.04))   // 40 ms window

  // Buffer too short to WSOLA — return as-is and let the caller use plain playback
  if (buf.length <= winSize) return buf
  const hopA      = Math.round(winSize / 2)
  const hopS      = Math.max(1, Math.round(hopA * stretchFactor))
  const search    = Math.round(hopA / 4)

  const nCh   = buf.numberOfChannels
  const inLen = buf.length
  const outLen = Math.max(1, Math.round(inLen * stretchFactor))

  const win = new Float32Array(winSize)
  for (let i = 0; i < winSize; i++)
    win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (winSize - 1))

  const ch0    = buf.getChannelData(0)
  const outs   = Array.from({ length: nCh }, () => new Float32Array(outLen))
  const norm   = new Float32Array(outLen)

  let inPos  = 0
  let outPos = 0
  let prevPos = 0
  let first  = true

  while (outPos < outLen && inPos < inLen) {
    const grain = Math.min(winSize, inLen - inPos)
    let bestPos = Math.max(0, Math.min(inLen - grain, inPos))

    if (!first && search > 0) {
      const slo = Math.max(0, inPos - search)
      const shi = Math.min(inLen - grain, inPos + search)
      let bestCorr = -Infinity
      const corrLen = Math.min(grain, 512)
      const refStart = prevPos + hopA
      for (let s = slo; s <= shi; s += 2) {
        let corr = 0
        for (let k = 0; k < corrLen; k++) {
          if (refStart + k < inLen)
            corr += ch0[refStart + k] * (s + k < inLen ? ch0[s + k] : 0)
        }
        if (corr > bestCorr) { bestCorr = corr; bestPos = s }
      }
    }
    first = false

    for (let c = 0; c < nCh; c++) {
      const inp = buf.getChannelData(c)
      for (let i = 0; i < grain && outPos + i < outLen; i++)
        outs[c][outPos + i] += inp[bestPos + i] * win[i]
    }
    for (let i = 0; i < grain && outPos + i < outLen; i++)
      norm[outPos + i] += win[i]

    prevPos = bestPos
    inPos  += hopA
    outPos += hopS
  }

  for (let c = 0; c < nCh; c++)
    for (let i = 0; i < outLen; i++)
      if (norm[i] > 0.01) outs[c][i] /= norm[i]

  const result = new AudioBuffer({ length: outLen, sampleRate: sr, numberOfChannels: nCh })
  for (let c = 0; c < nCh; c++) result.copyToChannel(outs[c], c)
  return result
}

// Extract the region between trimStart and (buf.duration − trimEnd) as a new buffer.
export function extractTrimmed(buf: AudioBuffer, trimStart: number, trimEnd: number): AudioBuffer {
  const sr  = buf.sampleRate
  const s0  = Math.round(trimStart * sr)
  const s1  = Math.max(s0 + 1, Math.round((buf.duration - trimEnd) * sr))
  const len = Math.min(buf.length - s0, s1 - s0)
  const out = new AudioBuffer({ length: Math.max(1, len), sampleRate: sr, numberOfChannels: buf.numberOfChannels })
  for (let c = 0; c < buf.numberOfChannels; c++)
    out.copyToChannel(buf.getChannelData(c).subarray(s0, s0 + len), c)
  return out
}
