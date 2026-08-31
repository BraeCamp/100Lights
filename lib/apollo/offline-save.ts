'use client'
// "Save for offline" — the whole action, from a project id.
//
// Brae: "We still want server rendering to work so that users can save their
// projects from the cloud for offline use... But it will be manual." And:
// "Wire it to a right click menu button so that users can connect from their
// project pages."
//
// A project page has an id and nothing else — no engine, no loaded project, no
// audio context. So this fetches the saved file, works out which tracks are
// Apollo tracks (the same way the engine does, see resolve-apollo.ts), asks the
// server for each clip's render, and writes them into local storage. After it
// runs, opening that project needs no network for its audio.
//
// ⚠️ Everything heavy is imported LAZILY. This module is reachable from
// /projects and every app dashboard, which are lists — they must not pull the
// audio engine, the freeze cache, or the Apollo patch code into their bundle
// for a menu item most visitors never click.

export interface OfflineProgress {
  /** Clips secured so far, and how many there are in total. */
  done: number
  total: number
  phase: 'reading' | 'rendering' | 'done'
}

export interface OfflineResult {
  saved: number
  total: number
  /** Set when nothing could be saved and it is worth saying why. */
  note?: string
}

/** Anything that is not a real failure still has to be SAID, or the button
 *  reports success over a project that got nothing. */
export class OfflineSaveError extends Error {}

/**
 * Fetch a cloud project and secure its audio for offline use.
 *
 * Resolves with what actually happened rather than throwing for the ordinary
 * "nothing to do" cases — a project with no Apollo tracks is a normal project,
 * not an error, and saying "nothing to save" is the honest answer.
 */
export async function saveProjectForOffline(
  projectId: string,
  onProgress?: (p: OfflineProgress) => void,
): Promise<OfflineResult> {
  onProgress?.({ done: 0, total: 0, phase: 'reading' })

  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`)
  if (!res.ok) {
    throw new OfflineSaveError(
      res.status === 401 || res.status === 404
        ? 'That project could not be opened.'
        : `Could not read the project (${res.status}).`,
    )
  }
  const file = await res.json() as { dawProject?: unknown } | null
  const project = file?.dawProject as Parameters<
    typeof import('./resolve-apollo').apolloGroupsForProject
  >[0] | undefined
  if (!project) throw new OfflineSaveError('That project has no audio to save.')

  const { apolloGroupsForProject } = await import('./resolve-apollo')
  const groups = apolloGroupsForProject(project)
  const total = groups.reduce((n, g) => n + g.clips.length, 0)
  if (!total) {
    // Not a failure. A project can be entirely samples, drums or plugins, none
    // of which the server can render — those tracks already live on the device.
    return { saved: 0, total: 0, note: 'Nothing here needs the server — this project already plays offline.' }
  }

  onProgress?.({ done: 0, total, phase: 'rendering' })
  const { saveForOffline } = await import('./freeze-cache')
  const bpm = (project as { tempo?: number }).tempo ?? 120
  const out = await saveForOffline(bpm, groups, (done, t) =>
    onProgress?.({ done, total: t, phase: 'rendering' }))

  onProgress?.({ done: out.saved, total: out.total, phase: 'done' })
  return {
    saved: out.saved,
    total: out.total,
    // Partial is the expected outcome for a project mixing synths with sampled
    // instruments, and it is worth naming so it does not read as a failure.
    note: out.saved === 0
      ? 'The server could not render any of this project — it still plays live.'
      : out.saved < out.total
        ? `${out.total - out.saved} part${out.total - out.saved === 1 ? '' : 's'} use sounds from your library and stay on this device.`
        : undefined,
  }
}
