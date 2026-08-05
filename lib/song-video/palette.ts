// Pull a video theme (accent + background gradient) out of an uploaded image:
// the most vibrant colour becomes the accent, the average of the darker pixels
// becomes the background gradient. Client-only (canvas).

const hex = (c: number[]) => '#' + c.map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('')

export async function extractPalette(file: File): Promise<{ accent: string; bg: [string, string] }> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not read image')); i.src = url })
    const W = 64, H = Math.max(1, Math.round(64 * (img.height || 1) / (img.width || 1)))
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H
    const ctx = cv.getContext('2d'); if (!ctx) throw new Error('canvas unavailable')
    ctx.drawImage(img, 0, 0, W, H)
    const d = ctx.getImageData(0, 0, W, H).data

    let accent = [167, 139, 250], accScore = -1
    let dr = 0, dg = 0, db = 0, n = 0
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2]
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
      const sat = mx === 0 ? 0 : (mx - mn) / mx, val = mx / 255
      const score = sat * val * val
      if (score > accScore) { accScore = score; accent = [r, g, b] }
      if (val < 0.4) { dr += r; dg += g; db += b; n++ }
    }
    const dk = n ? [dr / n, dg / n, db / n] : [12, 10, 18]
    return { accent: hex(accent), bg: [hex(dk.map(x => x * 0.9 + 6)), hex(dk.map(x => x * 0.45))] }
  } finally { URL.revokeObjectURL(url) }
}
