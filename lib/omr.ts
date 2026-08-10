// Local Optical Music Recognition (OMR) — the FREE, no-AI pass for the "hear sheet music" app. Mirrors
// the transcription hybrid (lib/poly-detect + lib/transcribe-confidence): recognize clean printed scores
// entirely in-program (client-side canvas), return a ParsedMidi + a self-confidence score, and let the
// caller escalate ONLY low-confidence pages to the Claude-vision route. Deterministic + dependency-free.
//
// v1 target: clean printed MONOPHONIC scores. Pitch (staff-position → MIDI) is the strong part; rhythm
// is quarter-note-assumed for now (hearable + pitch-correct), with stem/flag duration to follow.
//
// The pipeline is split into PURE stages that operate on plain typed arrays (no DOM), so they can be
// unit-tested headlessly by synthesizing ImageData. recognizeScore() is the only DOM-touching entry.
import type { ParsedMidi } from './midi-file'

// ── Types ──────────────────────────────────────────────────────────────────────────────────────
export interface Binary { bits: Uint8Array; w: number; h: number } // bits: 1 = ink (dark), 0 = paper
export interface Staff { lines: number[]; spacing: number; top: number; bottom: number; xL: number; xR: number } // lines top→bottom (y asc); xL/xR = horizontal ink extent of the staff lines
export interface Notehead { cx: number; cy: number; w: number; h: number; filled: boolean; staff: number }
export type Clef = 'treble' | 'bass'

export interface OmrResult extends ParsedMidi {
  confidence: number          // 0..1 — gate for hybrid escalation to AI
  stavesFound: number
  heads: number
  warnings: string[]
}
export interface OmrOptions {
  clef?: Clef                 // default 'treble'
  bpm?: number                // tempo written into the result (default 100)
}

// ── Stage 1: grayscale + Otsu binarization ───────────────────────────────────────────────────────
export function toGrayBinary(data: Uint8ClampedArray, w: number, h: number): Binary {
  const n = w * h
  const gray = new Uint8Array(n)
  const hist = new Uint32Array(256)
  for (let i = 0; i < n; i++) {
    const o = i * 4
    // Rec.601 luma; ignore alpha (assume opaque scan)
    const g = (data[o] * 299 + data[o + 1] * 587 + data[o + 2] * 114) / 1000 | 0
    gray[i] = g
    hist[g]++
  }
  // Otsu threshold
  let sum = 0
  for (let t = 0; t < 256; t++) sum += t * hist[t]
  let sumB = 0, wB = 0, maxVar = -1, thr = 127
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (wB === 0) continue
    const wF = n - wB
    if (wF === 0) break
    sumB += t * hist[t]
    const mB = sumB / wB, mF = (sum - sumB) / wF
    const v = wB * wF * (mB - mF) * (mB - mF)
    if (v > maxVar) { maxVar = v; thr = t }
  }
  const bits = new Uint8Array(n)
  // Otsu's class boundary is inclusive of the dark class ([0..thr]); use <= so a pure black/white
  // image (thr lands at 0) still marks the black ink as foreground.
  for (let i = 0; i < n; i++) bits[i] = gray[i] <= thr ? 1 : 0
  return { bits, w, h }
}

// ── Stage 2: staff-line detection (horizontal projection) ─────────────────────────────────────────
export function detectStaves(bin: Binary): Staff[] {
  const { bits, w, h } = bin
  const rowDark = new Uint32Array(h)
  let maxRow = 0
  for (let y = 0; y < h; y++) {
    let c = 0
    const base = y * w
    for (let x = 0; x < w; x++) c += bits[base + x]
    rowDark[y] = c
    if (c > maxRow) maxRow = c
  }
  if (maxRow === 0) return []
  // A staff line spans most of the width. Rows above this are line candidates.
  const lineThresh = Math.max(0.45 * maxRow, 0.3 * w)
  // Merge vertically-adjacent candidate rows into single line centers (weighted centroid).
  const centers: number[] = []
  let y = 0
  while (y < h) {
    if (rowDark[y] >= lineThresh) {
      let y2 = y, wsum = 0, wnum = 0
      while (y2 < h && rowDark[y2] >= lineThresh) { wsum += rowDark[y2] * y2; wnum += rowDark[y2]; y2++ }
      centers.push(wnum ? wsum / wnum : y)
      y = y2
    } else y++
  }
  if (centers.length < 5) return []
  // Group centers into staves of 5 with a consistent gap. Estimate S from the median consecutive gap.
  const gaps: number[] = []
  for (let i = 1; i < centers.length; i++) gaps.push(centers[i] - centers[i - 1])
  const S = median(gaps)
  if (!(S > 1)) return []
  const staves: Staff[] = []
  let group: number[] = [centers[0]]
  for (let i = 1; i < centers.length; i++) {
    const g = centers[i] - centers[i - 1]
    if (g >= 0.6 * S && g <= 1.6 * S) group.push(centers[i])
    else { flushGroup(group, staves, S); group = [centers[i]] }
    if (group.length === 5) { flushGroup(group, staves, S); group = [] }
  }
  flushGroup(group, staves, S)
  for (const st of staves) { const ext = staffExtent(bin, st); st.xL = ext[0]; st.xR = ext[1] }
  return staves
}
// Horizontal ink extent of a staff (leftmost/rightmost dark pixel across its 5 line rows).
function staffExtent(bin: Binary, st: Staff): [number, number] {
  const { bits, w } = bin
  let xL = w, xR = 0
  for (const lyR of st.lines) {
    const base = Math.round(lyR) * w
    for (let x = 0; x < w; x++) if (bits[base + x]) { if (x < xL) xL = x; if (x > xR) xR = x }
  }
  return xR >= xL ? [xL, xR] : [0, w - 1]
}
// Staff-start lead-in (in units of spacing S) occupied by clef + time signature — noteheads whose
// centre falls inside it are glyphs, not notes, and are skipped. (v1 assumes no key signature; a wider
// lead-in than this is treated as a key-signature risk signal in recognizeImageData.)
const LEADIN_STEPS = 3
function flushGroup(group: number[], out: Staff[], S: number): void {
  if (group.length < 5) return
  // If a run is longer than 5 (two stacked staves merged), split into consecutive 5s.
  for (let i = 0; i + 5 <= group.length; i += 5) {
    const lines = group.slice(i, i + 5)
    const sp = (lines[4] - lines[0]) / 4
    out.push({ lines, spacing: sp, top: lines[0], bottom: lines[4], xL: 0, xR: 0 })   // xL/xR filled by staffExtent in detectStaves
  }
}

// ── Stage 3: staff-line removal (keep symbols crossing lines) ─────────────────────────────────────
export function removeStaffLines(bin: Binary, staves: Staff[]): Binary {
  const { bits, w, h } = bin
  const out = new Uint8Array(bits)                // copy
  const S = staves.length ? median(staves.map(s => s.spacing)) : 8
  const t = Math.max(1, Math.round(S * 0.18))     // approx line thickness
  const probe = t + 2                             // look this far above/below to spot a stem/notehead
  for (const st of staves) {
    for (const lyRaw of st.lines) {
      const ly = Math.round(lyRaw)
      for (let dy = -t; dy <= t; dy++) {
        const yy = ly + dy
        if (yy < 0 || yy >= h) continue
        const base = yy * w
        for (let x = 0; x < w; x++) {
          if (!out[base + x]) continue
          const ay = ly - probe, by = ly + probe
          const above = ay >= 0 && bits[ay * w + x]
          const below = by < h && bits[by * w + x]
          if (!(above && below)) out[base + x] = 0   // just the line here → erase; a crossing stem stays
        }
      }
    }
  }
  return { bits: out, w, h }
}

// Binary morphological closing (dilate then erode, 3×3). Reconnects rings/strokes that staff-line
// removal severed (esp. thin HOLLOW half/whole noteheads) and bridges ≤2px gaps, without filling a
// notehead's central hole (that hole is ~S px wide, far larger than the kernel) or merging separate
// noteheads (they sit >S apart).
export function closeBinary(bin: Binary): Binary {
  const { bits, w, h } = bin
  const dil = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0
    for (let dy = -1; dy <= 1 && !v; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy
      if (nx >= 0 && nx < w && ny >= 0 && ny < h && bits[ny * w + nx]) { v = 1; break }
    }
    dil[y * w + x] = v
  }
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 1
    for (let dy = -1; dy <= 1 && v; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || nx >= w || ny < 0 || ny >= h || !dil[ny * w + nx]) { v = 0; break }
    }
    out[y * w + x] = v
  }
  return { bits: out, w, h }
}

// ── Stage 4: notehead detection (connected components + widest-band localization) ─────────────────
// Robust for standard FILLED noteheads (the common case): flood-fill components, then localize the head
// as the widest vertical band (row ink-count) so stems/beams/ledger lines fall away. HOLLOW half/whole
// heads are a known miss — they yield no head here, so the score returns 0 notes and the caller
// escalates to AI (fail-safe), rather than a confident wrong answer.
export function findNoteheads(bin: Binary, staff: Staff, staffIndex: number): Notehead[] {
  const { bits, w, h } = bin
  const S = staff.spacing
  const y0 = Math.max(0, Math.floor(staff.top - 4 * S))
  const y1 = Math.min(h - 1, Math.ceil(staff.bottom + 4 * S))
  const labels = new Int32Array(w * (y1 - y0 + 1))
  const idx = (x: number, y: number) => x + (y - y0) * w
  const heads: Notehead[] = []
  const stack: number[] = []
  let label = 0
  for (let y = y0; y <= y1; y++) for (let x = 0; x < w; x++) {
    if (!bits[y * w + x] || labels[idx(x, y)]) continue
    label++
    const px: number[] = []
    stack.length = 0; stack.push(x, y); labels[idx(x, y)] = label
    let minX = x, maxX = x, minY = y, maxY = y
    while (stack.length) {
      const cy0 = stack.pop()!, cx0 = stack.pop()!
      px.push(cx0, cy0)
      if (cx0 < minX) minX = cx0; if (cx0 > maxX) maxX = cx0
      if (cy0 < minY) minY = cy0; if (cy0 > maxY) maxY = cy0
      for (let ddy = -1; ddy <= 1; ddy++) for (let ddx = -1; ddx <= 1; ddx++) {
        if (!ddx && !ddy) continue
        const nx = cx0 + ddx, ny = cy0 + ddy
        if (nx < 0 || nx >= w || ny < y0 || ny > y1) continue
        if (bits[ny * w + nx] && !labels[idx(nx, ny)]) { labels[idx(nx, ny)] = label; stack.push(nx, ny) }
      }
    }
    const bw = maxX - minX + 1, bh = maxY - minY + 1
    if (bw < 0.6 * S || bh < 0.5 * S) continue          // dust / thin fragment
    if (bw > 6 * S && bh > 6 * S) continue               // huge blob (not a notehead)
    const rowCount = new Uint32Array(bh)
    for (let k = 0; k < px.length; k += 2) rowCount[px[k + 1] - minY]++
    let maxRun = 0, argRow = 0
    for (let r = 0; r < bh; r++) if (rowCount[r] > maxRun) { maxRun = rowCount[r]; argRow = r }
    if (maxRun < 0.8 * S) continue                       // widest row too narrow → a stem/artifact
    let r0 = argRow, r1 = argRow
    while (r0 > 0 && rowCount[r0 - 1] > 0.55 * maxRun) r0--
    while (r1 < bh - 1 && rowCount[r1 + 1] > 0.55 * maxRun) r1++
    const bandH = r1 - r0 + 1
    if (bandH < 0.5 * S || bandH > 1.8 * S) continue     // not a notehead-shaped band
    let sx = 0, sn = 0, sy = 0
    for (let k = 0; k < px.length; k += 2) { const ry = px[k + 1] - minY; if (ry >= r0 && ry <= r1) { sx += px[k]; sy += px[k + 1]; sn++ } }
    if (!sn) continue
    const cx = sx / sn, cyc = sy / sn
    const headW = maxRun, headH = bandH
    if (headW < 0.85 * S || headW > 2.0 * S) continue    // notehead width ~1.2–1.5 S
    if (cx < staff.xL + LEADIN_STEPS * S) continue        // clef/time-signature lead-in → a glyph, not a note
    const fill = sn / (headW * headH)
    heads.push({ cx, cy: cyc, w: headW, h: headH, filled: fill > 0.62, staff: staffIndex })
  }
  heads.sort((a, b) => a.cx - b.cx)
  return heads
}

// ── Stage 5: pitch from vertical staff position ───────────────────────────────────────────────────
const SEMI = [0, 2, 4, 5, 7, 9, 11]                      // C D E F G A B  (semitone offsets, C=0)
// Bottom staff line: treble = E4 (letter idx 2, octave 4); bass = G2 (letter idx 4, octave 2).
const CLEF_BOTTOM: Record<Clef, { letter: number; octave: number }> = {
  treble: { letter: 2, octave: 4 },
  bass:   { letter: 4, octave: 2 },
}
export function pitchOf(cy: number, staff: Staff, clef: Clef = 'treble'): number {
  const halfStep = staff.spacing / 2
  const pos = Math.round((staff.bottom - cy) / halfStep)  // diatonic steps above the bottom line (may be <0)
  const base = CLEF_BOTTOM[clef]
  const idx = base.letter + pos
  const letter = ((idx % 7) + 7) % 7
  const octave = base.octave + Math.floor(idx / 7)
  return 12 * (octave + 1) + SEMI[letter]                 // MIDI (C4 = 60)
}

// ── Pipeline: pure (testable) core over ImageData-like input ─────────────────────────────────────
export function recognizeImageData(data: Uint8ClampedArray, w: number, h: number, opts: OmrOptions = {}): OmrResult {
  const clef = opts.clef ?? 'treble'
  const warnings: string[] = []
  const bin = toGrayBinary(data, w, h)
  const staves = detectStaves(bin)
  if (!staves.length) {
    return { notes: [], name: 'Sheet music', tempo: opts.bpm ?? 100, confidence: 0, stavesFound: 0, heads: 0, warnings: ['no staff lines detected'] }
  }
  const removed = removeStaffLines(bin, staves)
  const allHeads: Notehead[] = []
  staves.forEach((st, i) => { for (const hd of findNoteheads(removed, st, i)) allHeads.push(hd) }) // eslint-disable-line
  // Reading order: staff by staff (top→bottom), left→right within a staff.
  allHeads.sort((a, b) => a.staff - b.staff || a.cx - b.cx)
  if (!allHeads.length) warnings.push('no noteheads detected')

  // v1 rhythm: quarter-note assumption — sequential 1-beat notes. Pitch is the real output.
  const notes = allHeads.map((hd, i) => ({
    pitch: Math.max(0, Math.min(127, pitchOf(hd.cy, staves[hd.staff], clef))),
    startBeat: i,
    durationBeats: 1,
    velocity: 90,
  }))

  // Confidence: staff-spacing regularity × notehead-width consistency. Gates the hybrid escalation.
  const spConsistency = staffConsistency(staves)
  const S = median(staves.map(s => s.spacing))
  const widthOk = allHeads.length ? allHeads.filter(hd => hd.w >= 0.9 * S && hd.w <= 1.8 * S).length / allHeads.length : 0
  let confidence = allHeads.length ? +(0.5 * spConsistency + 0.5 * widthOk).toFixed(3) : 0
  if (spConsistency < 0.7) warnings.push('irregular staff spacing (skew or low-res scan)')

  // SAFETY: v1 doesn't read key signatures or accidentals, so it would return confident-but-WRONG
  // pitches on those scores. Detect their likely presence and drop confidence below the escalation
  // floor, so the caller routes to the AI pass instead of silently mis-reading.
  const risk = keyOrAccidentalRisk(removed, staves, allHeads, S)
  if (risk) { confidence = Math.min(confidence, 0.4); warnings.push(risk) }

  return { notes, name: 'Sheet music', tempo: opts.bpm ?? 100, confidence, stavesFound: staves.length, heads: allHeads.length, warnings }
}

// ── DOM entry: decode a File/image to ImageData, then run the pure pipeline ───────────────────────
export async function recognizeScore(file: File, opts: OmrOptions = {}): Promise<OmrResult> {
  if (typeof document === 'undefined') throw new Error('recognizeScore must run in the browser')
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image()
      im.onload = () => resolve(im)
      im.onerror = () => reject(new Error('Could not decode image'))
      im.src = url
    })
    // Cap the working resolution so huge scans stay fast, but keep enough detail for staff spacing.
    const maxW = 1600
    const scale = img.naturalWidth > maxW ? maxW / img.naturalWidth : 1
    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('Canvas unavailable')
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h)     // flatten any transparency to white paper
    ctx.drawImage(img, 0, 0, w, h)
    const { data } = ctx.getImageData(0, 0, w, h)
    return recognizeImageData(data, w, h, opts)
  } finally {
    URL.revokeObjectURL(url)
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────
function median(arr: number[]): number {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
// Detect a KEY SIGNATURE — which v1 can't read, so it would return confident-but-wrong pitches. A bare
// clef + time signature places the first notehead ~7.8 S past the staff start; each key-signature
// accidental adds ~0.95 S. So a first-note lead-in wider than 8.7 S flags a key signature for AI
// escalation. (Measured on engraved output; resolution-independent since it's in units of S.)
// Inline mid-staff accidentals remain a known v1 gap — a reliable detector needs v2 glyph recognition.
function keyOrAccidentalRisk(_bin: Binary, staves: Staff[], heads: Notehead[], S: number): string {
  for (let i = 0; i < staves.length; i++) {
    const first = heads.filter(hd => hd.staff === i).sort((a, b) => a.cx - b.cx)[0]
    if (first && first.cx - staves[i].xL > 8.7 * S) return 'possible key signature — used AI for accuracy'
  }
  return ''
}
function staffConsistency(staves: Staff[]): number {
  // 1 = perfectly even line spacing; drops as within-staff gaps vary.
  let worst = 1
  for (const st of staves) {
    const gaps: number[] = []
    for (let i = 1; i < st.lines.length; i++) gaps.push(st.lines[i] - st.lines[i - 1])
    const m = median(gaps)
    if (m <= 0) return 0
    const dev = gaps.reduce((s, g) => s + Math.abs(g - m), 0) / gaps.length / m
    worst = Math.min(worst, Math.max(0, 1 - dev * 2))
  }
  return worst
}
