'use client'
// The microphone level, off React.
//
// Brae, after the measurement: the meter's last cost was the card and the
// control re-rendering on every painted level. The level is a number that
// changes twenty times a second and is only ever DRAWN — a canvas, a bar, a
// line — so it never needed to be component state at all. It lives here: the
// recorder publishes it, and the things that draw it subscribe and paint
// themselves. Nothing re-renders.

export interface LevelReading {
  /** 0–1 input level. */
  level: number
  /** 0–1 bar the level is judged against. */
  threshold: number
}

const reading: LevelReading = { level: 0, threshold: 0 }
const subs = new Set<(r: LevelReading) => void>()

/** The recorder's tick. Cheap: subscribers write pixels, not state. */
export function publishLevel(level: number, threshold: number): void {
  reading.level = level
  reading.threshold = threshold
  for (const f of subs) f(reading)
}

/** The current reading, for anything that paints on its own clock. */
export function readLevel(): LevelReading { return reading }

export function subscribeLevel(f: (r: LevelReading) => void): () => void {
  subs.add(f)
  return () => { subs.delete(f) }
}
