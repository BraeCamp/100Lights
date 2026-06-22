import { runMatchPipeline, AudioBuf } from '@/lib/server/pipeline'
import { decodeWav, encodeWav } from '@/lib/wav-codec'

export const maxDuration = 60

export async function POST(req: Request): Promise<Response> {
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return Response.json({ error: 'Could not parse request body' }, { status: 400 })
  }

  const vocalFile  = formData.get('vocal')  as File | null
  const targetFile = formData.get('target') as File | null
  const optsStr    = formData.get('opts')   as string | null

  if (!vocalFile)  return Response.json({ error: 'Missing vocal field' },  { status: 400 })
  if (!targetFile) return Response.json({ error: 'Missing target field' }, { status: 400 })

  let opts: { strength?: number; gapFill?: number } = {}
  if (optsStr) {
    try { opts = JSON.parse(optsStr) as typeof opts } catch { /* use defaults */ }
  }

  try {
    const vocalWav  = decodeWav(await vocalFile.arrayBuffer())
    const targetWav = decodeWav(await targetFile.arrayBuffer())

    const vocalBuf  = AudioBuf.fromChannels(vocalWav.channels,  vocalWav.sampleRate)
    const targetBuf = AudioBuf.fromChannels(targetWav.channels, targetWav.sampleRate)

    const result = runMatchPipeline(vocalBuf, targetBuf, opts)

    const channels: Float32Array[] = []
    for (let ch = 0; ch < result.numberOfChannels; ch++) channels.push(result.getChannelData(ch))
    const wavOut = encodeWav(channels, result.sampleRate)

    return new Response(wavOut, {
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': String(wavOut.byteLength),
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[match-vocal]', msg)
    return Response.json({ error: msg }, { status: 500 })
  }
}
