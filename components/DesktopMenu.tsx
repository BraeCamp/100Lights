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
      if (!STUDIO_COMMANDS.has(command)) return
      // The studio listens for these on the window. A menu item that fires into
      // nothing is better than one that reloads the page to be sure: outside the
      // editor there is simply nothing to save or export, and nothing happens.
      window.dispatchEvent(new CustomEvent('100lights:menu', { detail: { command } }))
    })
  }, [router])

  return null
}
