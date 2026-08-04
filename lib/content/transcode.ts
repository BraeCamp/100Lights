import { spawn } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

// webm → mp4 (H.264/AAC, faststart) via the system ffmpeg. Needed only for the
// Buffer route (Instagram/TikTok want mp4); YouTube accepts the webm as-is.
// Runs locally where the admin uses this — ffmpeg is a hard dependency for the
// Buffer platforms only, so callers should catch and surface a clear message.

export async function webmToMp4(input: Uint8Array): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), 'content-'))
  const inPath = join(dir, 'in.webm')
  const outPath = join(dir, 'out.mp4')
  try {
    await writeFile(inPath, input)
    await new Promise<void>((resolve, reject) => {
      const ff = spawn('ffmpeg', [
        '-y', '-i', inPath,
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '20',
        '-c:a', 'aac', '-b:a', '160k',
        '-movflags', '+faststart',
        outPath,
      ])
      let err = ''
      ff.stderr.on('data', d => { err += d.toString() })
      ff.on('error', e => reject(new Error(`ffmpeg not available: ${e.message}`)))
      ff.on('close', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-500)}`))))
    })
    return await readFile(outPath)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
