// Microtuning: Scala .scl and AnaMark .tun parsers producing a 128-entry
// note→frequency table for the engine.

export interface TuningTable { name: string; freqs: number[] }

/** 12-TET reference for a MIDI note. */
const etFreq = (n: number): number => 440 * Math.pow(2, (n - 69) / 12)

/**
 * Scala .scl: after the description line and degree count, each line is a
 * degree as cents ("100.0") or a ratio ("3/2" or "2"). The scale maps degree 0
 * to MIDI note 60 at its 12-TET pitch and repeats at the last degree
 * (the formal octave).
 */
export function parseScl(text: string, name: string): TuningTable {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('!'))
  if (lines.length < 2) throw new Error('Not a valid .scl file')
  const count = parseInt(lines[1], 10)
  if (!Number.isFinite(count) || count < 1 || count > 128) throw new Error('Bad degree count in .scl')
  const degreesCents: number[] = [0]
  for (let i = 2; i < lines.length && degreesCents.length <= count; i++) {
    const tok = lines[i].split(/\s+/)[0]
    let cents: number
    if (tok.includes('/')) {
      const [a, b] = tok.split('/').map(Number)
      if (!a || !b) throw new Error(`Bad ratio: ${tok}`)
      cents = 1200 * Math.log2(a / b)
    } else if (tok.includes('.')) {
      cents = Number(tok)
    } else {
      const r = Number(tok)
      if (!Number.isFinite(r) || r <= 0) throw new Error(`Bad degree: ${tok}`)
      cents = 1200 * Math.log2(r)
    }
    if (!Number.isFinite(cents)) throw new Error(`Bad degree: ${tok}`)
    degreesCents.push(cents)
  }
  if (degreesCents.length !== count + 1) throw new Error('.scl degree count mismatch')
  const period = degreesCents[count] // formal octave in cents
  if (period <= 0) throw new Error('.scl has a non-positive period')
  const baseNote = 60
  const baseFreq = etFreq(baseNote)
  const freqs: number[] = []
  for (let n = 0; n < 128; n++) {
    const rel = n - baseNote
    const oct = Math.floor(rel / count)
    const deg = ((rel % count) + count) % count
    const cents = oct * period + degreesCents[deg]
    freqs.push(baseFreq * Math.pow(2, cents / 1200))
  }
  return { name, freqs }
}

/**
 * AnaMark .tun: an INI-ish file; the [Tuning] section lists `note X=cents`
 * where cents are absolute from 8.1757989156 Hz (MIDI 0 in 12-TET).
 * [Exact Tuning] uses the same layout with fractional cents.
 */
export function parseTun(text: string, name: string): TuningTable {
  const freqs = Array.from({ length: 128 }, (_, n) => etFreq(n))
  const base = 440 * Math.pow(2, -69 / 12) // 8.1757989156 Hz
  const re = /note\s*(\d+)\s*=\s*(-?[\d.]+)/gi
  let m: RegExpExecArray | null
  let found = 0
  while ((m = re.exec(text)) !== null) {
    const idx = Number(m[1])
    const cents = Number(m[2])
    if (idx >= 0 && idx < 128 && Number.isFinite(cents)) {
      freqs[idx] = base * Math.pow(2, cents / 1200)
      found++
    }
  }
  if (!found) throw new Error('No "note N=cents" entries found in .tun')
  return { name, freqs }
}

export function parseTuningFile(fileName: string, text: string): TuningTable {
  const base = fileName.replace(/\.[^.]+$/, '')
  if (/\.scl$/i.test(fileName)) return parseScl(text, base)
  if (/\.tun$/i.test(fileName)) return parseTun(text, base)
  // sniff
  if (/\[tuning\]|\[exact tuning\]/i.test(text)) return parseTun(text, base)
  return parseScl(text, base)
}
