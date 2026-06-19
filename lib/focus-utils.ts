export type FocusKeyframe = { time: number; x: number; y: number }

export function interpolateFocusKF(kf: FocusKeyframe[], localTime: number): { x: number; y: number } {
  if (kf.length === 0) return { x: 0.5, y: 0.5 }
  if (localTime <= kf[0].time) return { x: kf[0].x, y: kf[0].y }
  const last = kf[kf.length - 1]
  if (localTime >= last.time) return { x: last.x, y: last.y }
  let lo = 0, hi = kf.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (kf[mid].time <= localTime) lo = mid; else hi = mid
  }
  const t = (localTime - kf[lo].time) / (kf[hi].time - kf[lo].time)
  const p0 = kf[Math.max(0, lo - 1)]
  const p1 = kf[lo]
  const p2 = kf[hi]
  const p3 = kf[Math.min(kf.length - 1, hi + 1)]
  const cr = (a: number, b: number, c: number, d: number) =>
    0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t)
  return { x: cr(p0.x, p1.x, p2.x, p3.x), y: cr(p0.y, p1.y, p2.y, p3.y) }
}

// Convert Catmull-Rom keyframes to an SVG path string using cubic bezier commands.
// Coordinates are in 0–1 range (caller must apply viewBox="0 0 1 1").
export function buildFocusSVGPath(kf: FocusKeyframe[]): string {
  if (kf.length < 2) return ''
  const fmt = (n: number) => n.toFixed(5)
  const parts: string[] = [`M ${fmt(kf[0].x)} ${fmt(kf[0].y)}`]
  for (let i = 0; i < kf.length - 1; i++) {
    const p0 = kf[Math.max(0, i - 1)]
    const p1 = kf[i]
    const p2 = kf[i + 1]
    const p3 = kf[Math.min(kf.length - 1, i + 2)]
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    parts.push(`C ${fmt(cp1x)} ${fmt(cp1y)} ${fmt(cp2x)} ${fmt(cp2y)} ${fmt(p2.x)} ${fmt(p2.y)}`)
  }
  return parts.join(' ')
}
