'use client'
// What the desktop menu bar and the global shortcuts actually do.
//
// Brae asked for menus that make the desktop app "cleaner and work better". The
// menu already existed; what it lacked was a way to reach the app without
// destroying it. Every File-menu item ran `window.location.href = ...` in the
// renderer, which is a FULL PAGE LOAD — a new JavaScript context, the layout
// rebuilt, and everything living in it gone. Including Light, mid-sentence.
//
// So the menu sends a COMMAND and this answers it, with the client router and
// with the studio's own undo. Mounted once in the app layout, beside Light, for
// the same reason: it has to outlive the page it was opened from.

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Commands the studio answers by dispatching to whatever is listening. */
const STUDIO_COMMANDS = new Set([
  'save-version', 'export-audio', 'import', 'undo', 'redo',
  'transport-toggle', 'voice-toggle',
])

type OpenedFile = { name: string; text: string }
function isOpenedFile(arg: unknown): arg is OpenedFile {
  const f = arg as OpenedFile | undefined
  return typeof f?.name === 'string' && typeof f?.text === 'string'
}

/**
 * Open a project file the operating system handed us.
 *
 * The same two steps the projects page takes for a local file: parse it, leave
 * it where the project route looks for one, and go there. Reusing that handoff
 * rather than inventing a second one means a double-clicked file and a file
 * picked from the folder list arrive by exactly the same door.
 */
async function openProjectFile(file: OpenedFile, router: { push: (href: string) => void }) {
  try {
    // Imported here, not at the top: the serializer is a large module and this
    // is mounted in the layout of every page, desktop or not.
    const { readProjectFile } = await import('@/lib/project-serializer')
    const { project } = await readProjectFile(new File([file.text], file.name))
    localStorage.setItem(`cf_pending_cfproj_${project.id}`, JSON.stringify(project))
    router.push(`/projects/${project.id}`)
  } catch (e) {
    alert(e instanceof Error ? e.message
      : 'Could not open this file. It may be corrupted or not a valid 100Lights project.')
  }
}

export default function DesktopMenu() {
  const router = useRouter()

  useEffect(() => {
    const api = (window as unknown as { electronAPI?: { onMenuCommand?: (cb: (m: { command: string; arg?: unknown }) => void) => () => void } }).electronAPI
    if (!api?.onMenuCommand) return

    return api.onMenuCommand(({ command, arg }) => {
      if (command === 'navigate' && typeof arg === 'string') {
        // ⚠️ The whole point. router.push keeps the layout — and Light, and any
        // popped-out panel — alive across the trip.
        router.push(arg)
        return
      }
      // ⚠️ Double-clicking a .cfproj in Finder, or dropping one on the dock
      // icon. The main process reads the file and sends its CONTENTS, because
      // the renderer has no way to read a path and should not be given one.
      // Without this the file opening was inert: the app came to the front and
      // then simply sat there, which reads as "double-click is broken".
      if (command === 'open-file' && isOpenedFile(arg)) {
        void openProjectFile(arg, router)
        return
      }
      if (!STUDIO_COMMANDS.has(command)) return
      // The studio listens for these on the window. A menu item that fires into
      // nothing is better than one that reloads the page to be sure: outside the
      // editor there is simply nothing to save or export, and nothing happens.
      window.dispatchEvent(new CustomEvent('100lights:menu', { detail: { command } }))
    })
  }, [router])

  return null
}
