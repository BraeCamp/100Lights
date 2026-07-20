import { readdir, stat } from 'fs/promises'
import path from 'path'
import { isAdmin } from '@/lib/admin-auth'
import { listObjects } from '@/lib/r2'

export const runtime = 'nodejs'

// Lists every audio file an article can point at, from both homes:
//
//   public/learn-audio/*  — committed to the repo, produced by
//                           scripts/render-automation-audio.mjs
//   R2 learn-audio/*      — uploaded from the admin panel
//
// The repo files can't be replaced at runtime (read-only filesystem in
// production), so "fixing" one means re-running the render script and
// committing. Uploaded files can simply be replaced by uploading again. The
// `source` field tells the two apart in the UI.
const DIR = path.join(process.cwd(), 'public', 'learn-audio')

export interface AudioFile {
  name: string
  url: string
  bytes: number
  source: 'repo' | 'uploaded'
}

export async function GET() {
  if (!await isAdmin()) return Response.json({ error: 'Not signed in as admin' }, { status: 401 })

  const files: AudioFile[] = []

  try {
    for (const n of await readdir(DIR)) {
      if (!/\.(mp3|wav|ogg|m4a|webm)$/i.test(n)) continue
      files.push({
        name: n,
        url: `/learn-audio/${n}`,
        bytes: (await stat(path.join(DIR, n))).size,
        source: 'repo',
      })
    }
  } catch { /* directory may not exist — nothing to add */ }

  try {
    for (const o of await listObjects('learn-audio/')) {
      files.push({
        name: o.key.slice('learn-audio/'.length),
        url: `/api/learn-audio?key=${encodeURIComponent(o.key)}`,
        bytes: o.size,
        source: 'uploaded',
      })
    }
  } catch {
    // R2 unreachable or unconfigured — still return the repo files rather
    // than failing the whole listing.
  }

  files.sort((a, b) => a.name.localeCompare(b.name))
  return Response.json({ files })
}
