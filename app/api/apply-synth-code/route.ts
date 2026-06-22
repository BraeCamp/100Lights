import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

// Dev-only: replaces synthesizeFromPitchCurve in pitch-detector.ts with AI-improved version
export async function POST(req: Request) {
  if (process.env.NODE_ENV !== 'development') {
    return Response.json({ error: 'Dev only' }, { status: 403 })
  }

  const { code } = await req.json() as { code: string }
  if (!code?.includes('synthesizeFromPitchCurve')) {
    return Response.json({ error: 'Invalid function code' }, { status: 400 })
  }

  try {
    const filePath = join(process.cwd(), 'lib', 'pitch-detector.ts')
    const src = readFileSync(filePath, 'utf-8')

    const startMarker = 'export async function synthesizeFromPitchCurve('
    const start = src.indexOf(startMarker)
    if (start === -1) return Response.json({ error: 'Function not found in source' }, { status: 404 })

    let depth = 0
    let end = start
    for (let i = start; i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break } }
    }

    // Wrap as TypeScript export (the incoming code is JS — prepend export keyword)
    const tsCode = code.startsWith('export ') ? code : code.replace('async function synthesizeFromPitchCurve', 'export async function synthesizeFromPitchCurve')

    const updated = src.slice(0, start) + tsCode + src.slice(end)
    writeFileSync(filePath, updated, 'utf-8')

    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 })
  }
}
