import { readFileSync } from 'fs'
import { join } from 'path'

// Dev tool: returns the current synthesizeFromPitchCurve function source
export async function GET() {
  try {
    const filePath = join(process.cwd(), 'lib', 'pitch-detector.ts')
    const src = readFileSync(filePath, 'utf-8')

    // Extract synthesizeFromPitchCurve function body
    const startMarker = 'export async function synthesizeFromPitchCurve('
    const start = src.indexOf(startMarker)
    if (start === -1) return Response.json({ error: 'Function not found' }, { status: 404 })

    // Find matching closing brace
    let depth = 0
    let end = start
    for (let i = start; i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break } }
    }

    return Response.json({ code: src.slice(start, end) })
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 })
  }
}
