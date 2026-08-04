import { spawn } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

// webm → mp4 (H.264/AAC, faststart) via the system ffmpeg. Only reached when a
// video was recorded as webm AND a Buffer platform (Instagram/TikTok) is selected
// — the common path records mp4 in the browser, so this never runs. Production
// (Vercel) has no system ffmpeg, hence the actionable error: re-record (modern
// browsers output mp4) rather than trying to convert server-side.

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
      ff.on('error', () => reject(new Error('This video is webm and Instagram/TikTok need mp4. Re-record it (modern browsers output mp4 automatically), then send to the queue again.')))
      ff.on('close', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-500)}`))))
    })
    return await readFile(outPath)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
