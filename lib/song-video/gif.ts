// Compact self-contained GIF89a encoder (no deps): median-cut quantization to a
// shared 256-colour palette + LZW compression. Used to export a song-video loop
// as an animated GIF. Frames are RGBA ImageData; one global palette is built
// from sampled pixels and every frame is mapped to it.

type RGB = [number, number, number]
export interface GifFrame { data: Uint8ClampedArray; width: number; height: number }

// ── Median-cut quantization ──────────────────────────────────────────────────
function medianCut(samples: RGB[], maxColors: number): RGB[] {
  if (samples.length === 0) return [[0, 0, 0]]
  let boxes: RGB[][] = [samples]
  while (boxes.length < maxColors) {
    // Split the box with the largest colour range along its widest channel.
    let bi = -1, bestRange = -1, bestCh = 0
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i]; if (box.length < 2) continue
      const mn = [255, 255, 255], mx = [0, 0, 0]
      for (const p of box) for (let c = 0; c < 3; c++) { if (p[c] < mn[c]) mn[c] = p[c]; if (p[c] > mx[c]) mx[c] = p[c] }
      for (let c = 0; c < 3; c++) { const r = mx[c] - mn[c]; if (r > bestRange) { bestRange = r; bi = i; bestCh = c } }
    }
    if (bi < 0) break
    const box = boxes[bi]
    box.sort((a, b) => a[bestCh] - b[bestCh])
    const mid = box.length >> 1
    boxes.splice(bi, 1, box.slice(0, mid), box.slice(mid))
  }
  return boxes.map(box => {
    const sum: RGB = [0, 0, 0]
    for (const p of box) { sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2] }
    const n = Math.max(1, box.length)
    return [Math.round(sum[0] / n), Math.round(sum[1] / n), Math.round(sum[2] / n)] as RGB
  })
}

function nearest(pal: RGB[], r: number, g: number, b: number): number {
  let bi = 0, bd = Infinity
  for (let i = 0; i < pal.length; i++) { const p = pal[i], dr = p[0] - r, dg = p[1] - g, db = p[2] - b, d = dr * dr + dg * dg + db * db; if (d < bd) { bd = d; bi = i } }
  return bi
}

// ── LZW (GIF variant) ────────────────────────────────────────────────────────
function lzw(minCode: number, indices: Uint8Array): number[] {
  const clear = 1 << minCode, eoi = clear + 1
  let codeSize = minCode + 1, next = eoi + 1
  let dict = new Map<string, number>()
  const reset = () => { dict = new Map(); for (let i = 0; i < clear; i++) dict.set(String(i), i); next = eoi + 1; codeSize = minCode + 1 }
  const out: number[] = []
  let cur = 0, curBits = 0
  const emit = (code: number) => { cur |= code << curBits; curBits += codeSize; while (curBits >= 8) { out.push(cur & 0xff); cur >>= 8; curBits -= 8 } }
  reset(); emit(clear)
  let prev = String(indices[0])
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], key = prev + ',' + k
    if (dict.has(key)) { prev = key }
    else {
      emit(dict.get(prev)!)
      dict.set(key, next++)
      if (next > (1 << codeSize) && codeSize < 12) codeSize++
      if (next >= 4096) { emit(clear); reset() }
      prev = String(k)
    }
  }
  emit(dict.get(prev)!); emit(eoi)
  if (curBits > 0) out.push(cur & 0xff)
  return out
}

// ── GIF89a assembly ──────────────────────────────────────────────────────────
export function encodeGif(frames: GifFrame[], delayMs: number): Uint8Array {
  const W = frames[0].width, H = frames[0].height
  // Sample pixels across frames to build one global palette.
  const samples: RGB[] = []
  const stride = Math.max(4, Math.floor((W * H) / 4000)) * 4
  for (const fr of frames) for (let i = 0; i < fr.data.length; i += stride) samples.push([fr.data[i], fr.data[i + 1], fr.data[i + 2]])
  const pal = medianCut(samples, 256)
  while (pal.length < 256) pal.push([0, 0, 0])
  const minCode = 8, delayCs = Math.max(2, Math.round(delayMs / 10))

  const bytes: number[] = []
  const push = (...b: number[]) => { for (const x of b) bytes.push(x & 0xff) }
  const str = (s: string) => { for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i)) }
  const u16 = (n: number) => push(n & 0xff, (n >> 8) & 0xff)

  str('GIF89a'); u16(W); u16(H); push(0xf7, 0, 0) // global colour table, 256 entries, depth 8
  for (const c of pal) push(c[0], c[1], c[2])
  // Loop forever (NETSCAPE app extension)
  push(0x21, 0xff, 0x0b); str('NETSCAPE2.0'); push(0x03, 0x01, 0, 0, 0)

  for (const fr of frames) {
    // Graphic control (delay). No transparency.
    push(0x21, 0xf9, 0x04, 0x00, delayCs & 0xff, (delayCs >> 8) & 0xff, 0x00, 0x00)
    push(0x2c); u16(0); u16(0); u16(W); u16(H); push(0x00) // image descriptor, no local table
    const idx = new Uint8Array(W * H)
    for (let p = 0, j = 0; j < fr.data.length; j += 4, p++) idx[p] = nearest(pal, fr.data[j], fr.data[j + 1], fr.data[j + 2])
    push(minCode)
    const data = lzw(minCode, idx)
    for (let i = 0; i < data.length; i += 255) { const chunk = data.slice(i, i + 255); push(chunk.length); for (const b of chunk) push(b) }
    push(0x00) // block terminator
  }
  push(0x3b) // trailer
  return Uint8Array.from(bytes)
}
