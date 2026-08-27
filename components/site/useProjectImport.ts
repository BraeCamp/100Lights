'use client'

import { useCallback, useState } from 'react'
import { useUser } from '@clerk/nextjs'
import { openProjectsFromFile } from '@/lib/project-serializer'
import { openMediaInStudio } from '@/lib/media-handoff'

/**
 * Opening or importing project files.
 *
 * Extracted from the All Projects page so the module dashboards (Beacon,
 * Prism) can offer the same thing. Brae: "Previously I had asked you to make
 * it so that I can add projects from the Beacon and Prism dashboards. That
 * isn't present." Those pages could only ever start something new — every way
 * of bringing an EXISTING project in lived on /projects.
 *
 * A copy would have been quicker and would have drifted, because the details
 * here are not obvious: raw media opens a fresh video project rather than
 * importing anything; a single file opened by a signed-out visitor goes
 * straight into the editor via localStorage instead of the account; and
 * recordings that never reached storage have to be called out, because they
 * play now and vanish on reload.
 */
export function useProjectImport(onImported?: () => void) {
  const { isSignedIn, isLoaded } = useUser()
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)

  const openFromFile = useCallback(async () => {
    // Uploading a Firefly bundle's recordings can take a moment, so the
    // spinner goes up before the read, not after it.
    setImporting(true)
    let read
    try {
      read = await openProjectsFromFile()
    } finally {
      setImporting(false)
    }
    // Raw media (mp4, mov, mp3…) opens a fresh video project seeded with the clip.
    if (read.media.length) { await openMediaInStudio(read.media); return }

    const { projects: files, degraded, errors } = read

    // Recordings that never reached storage play now and die on reload — say
    // so, rather than letting the user find out later.
    const notes = [
      ...errors,
      ...(degraded
        ? [`${degraded} recording${degraded !== 1 ? 's' : ''} couldn't be saved to your library — ${degraded !== 1 ? 'they' : 'it'} will play now but won't survive a reload.`]
        : []),
    ]
    const flash = (msg: string) => {
      setImportMsg([msg, ...notes].join(' '))
      setTimeout(() => setImportMsg(null), 8000)
    }

    if (files.length === 0) {
      if (notes.length) flash('Nothing imported.')
      return
    }

    // A single file opens straight into the editor (edit-and-save flow).
    if (files.length === 1 && !isSignedIn) {
      const cfproj = files[0]
      localStorage.setItem(`cf_pending_cfproj_${cfproj.id}`, JSON.stringify(cfproj))
      window.location.href = `/projects/${cfproj.id}`
      return
    }
    if (!isSignedIn) { flash('Sign in to import project files to your account.'); return }

    // Signed in: import all selected files straight into the projects list.
    setImporting(true)
    let ok = 0, fail = 0, limit = false
    for (const cf of files) {
      try {
        const r = await fetch('/api/projects', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cf),
        })
        if (r.ok) ok++
        else { fail++; if (r.status === 403) limit = true }
      } catch { fail++ }
    }
    setImporting(false)
    flash(
      `Imported ${ok} project${ok !== 1 ? 's' : ''}` +
      (fail ? ` — ${fail} failed${limit ? ' (project limit reached)' : ''}` : '') + '.'
    )
    onImported?.()
  }, [isSignedIn, onImported])

  return { importing, importMsg, openFromFile, isSignedIn, isLoaded }
}
