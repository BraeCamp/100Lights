'use client'
// A panel that can leave the window.
//
// Brae: "can we make it so that windows and menus opened through the desktop
// app can move outside of the window?"
//
// A panel drawn in the page is DOM, and DOM is clipped to the viewport — no
// amount of CSS lets it sit on a second monitor. The only thing that can leave
// is a real OS window, so this opens one and RENDERS THE SAME REACT TREE INTO
// IT through a portal.
//
// ⚠️ A portal, not a second app. Loading the route again in the child would
// mean two React trees, two audio engines and two copies of the project trying
// to agree with each other. Portalling keeps one of everything: the state, the
// engine and the undo history all stay in the parent, and the child window is
// only somewhere to draw. Closing it changes nothing about the song.
//
// Works in the browser too — a popup is also a real OS window — but it is the
// desktop app this is for, where it behaves like a plugin window in any DAW.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

/** Marks the window for Electron, which allows these and only these to detach. */
export const POPOUT_PREFIX = '100lights-popout'

/**
 * Copy the app's styles into the new window.
 *
 * ⚠️ Both shapes, because both exist: Next.js serves <link> stylesheets in
 * production and inline <style> in development, and a pop-out that is beautiful
 * in one and unstyled in the other is a bug somebody finds at the worst moment.
 *
 * The theme comes too — it lives as attributes and custom properties on <html>,
 * so a child that copied only the sheets would render light-mode panels inside
 * a dark studio.
 */
function adoptStyles(child: Window): void {
  const head = child.document.head
  for (const node of Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))) {
    head.appendChild(node.cloneNode(true))
  }
  const from = document.documentElement
  const to = child.document.documentElement
  to.className = from.className
  for (const attr of Array.from(from.attributes)) {
    if (attr.name.startsWith('data-')) to.setAttribute(attr.name, attr.value)
  }
  // Inline custom properties set on :root at runtime (the theme editor writes
  // these) are not in any stylesheet.
  to.setAttribute('style', from.getAttribute('style') ?? '')
  child.document.body.style.margin = '0'
  child.document.body.style.background = getComputedStyle(document.body).backgroundColor || '#14121a'
  child.document.body.style.color = getComputedStyle(document.body).color || '#fff'
}

export default function PopOut({
  title, width = 720, height = 520, onClose, children,
}: {
  title: string
  width?: number
  height?: number
  /** Called when the OS window is closed, by the user or by us. */
  onClose: () => void
  children: React.ReactNode
}) {
  const [host, setHost] = useState<HTMLElement | null>(null)

  useEffect(() => {
    // The name is what Electron matches on to allow a real window; the browser
    // uses it to avoid reusing an existing popup for a different panel.
    const name = `${POPOUT_PREFIX}-${title.replace(/\W+/g, '-').toLowerCase()}`
    const child = window.open('', name, `width=${width},height=${height}`)
    if (!child) {
      // Blocked, which a browser will do without asking. Saying so beats a
      // button that silently does nothing.
      onClose()
      return
    }
    child.document.title = title
    adoptStyles(child)
    const mount = child.document.createElement('div')
    mount.style.height = '100%'
    child.document.body.appendChild(mount)
    setHost(mount)

    // ⚠️ Closing the OS window has to tell React, or the panel stays "open"
    // with nowhere to draw and cannot be reopened.
    const bye = () => onClose()
    child.addEventListener('beforeunload', bye)
    // And if the parent goes away — navigation, a reload — the child must not
    // outlive it as an orphan nothing can close.
    const closeChild = () => child.close()
    window.addEventListener('beforeunload', closeChild)

    return () => {
      child.removeEventListener('beforeunload', bye)
      window.removeEventListener('beforeunload', closeChild)
      setHost(null)
      child.close()
    }
    // Deliberately once per pop-out: re-running would close and reopen the
    // window under the person using it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return host ? createPortal(children, host) : null
}
