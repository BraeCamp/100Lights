import { runPipeline, AudioBuf } from '@/lib/server/pipeline'
import { decodeWav, encodeWav } from '@/lib/wav-codec'

// Allow up to 60 seconds (Vercel Pro) and 8MB body
export const maxDuration = 60

export async function POST(req: Request): Promise<Response> {
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return Response.json({ error: 'Could not parse request body' }, { status: 400 })
  }

  const audioFile  = formData.get('audio')  as File | null
  const refFile    = formData.get('refAudio') as File | null
  const optsStr    = formData.get('opts') as string | null

  if (!audioFile) return Response.json({ error: 'Missing audio field' }, { status: 400 })

  let opts: { harmProfile?: number[] | null; filterCutoff?: number; pitchShift?: number } = {}
  if (optsStr) {
    try { opts = JSON.parse(optsStr) as typeof opts } catch { /* use defaults */ }
  }

  try {
    // Decode source audio
    const srcWav = decodeWav(await audioFile.arrayBuffer())
    const srcBuf = AudioBuf.fromChannels(srcWav.channels, srcWav.sampleRate)

    // Decode reference audio (optional)
    let refBuf: AudioBuf | null = null
    if (refFile) {
      const refWav = decodeWav(await refFile.arrayBuffer())
      refBuf = AudioBuf.fromChannels(refWav.channels, refWav.sampleRate)
    }

    // Run the full pipeline server-side
    const result = runPipeline(srcBuf, refBuf, opts)

    // Encode result as WAV
    const channels: Float32Array[] = []
    for (let ch = 0; ch < result.numberOfChannels; ch++) {
      channels.push(result.getChannelData(ch))
    }
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
    console.error('[process-synth]', msg)
    return Response.json({ error: msg }, { status: 500 })
  }
}
