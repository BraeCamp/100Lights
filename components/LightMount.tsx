'use client'
// The one place Light is mounted.
//
// Brae: "The primary thing is to help light survive the trip with the switch to
// layout."
//
// It used to be rendered by the DAW's transport bar, which made it a child of
// the editor: leaving the editor unmounted it, and everything it was holding —
// the conversation history, a question it had just asked, what you had
// selected — went with it. "Open the video module" could never have worked,
// because the thing being asked would stop existing on the way there.
//
// ⚠️ Mounted here, as a stable sibling of the page, it survives every
// client-side navigation inside the app. A full page load still resets it, and
// always will: that is a new JavaScript context and there is nothing to carry.
//
// ⚠️ AND EXACTLY ONE OF IT. Two instances would be two microphones, with the
// second one listening to the first. The transport no longer renders Light; it
// offers a slot, and Light portals its button into it — same place on screen as
// before, one instance behind it.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname } from 'next/navigation'
import nextDynamic from 'next/dynamic'
import { useLightSlot } from '@/lib/voice/light-slot'

/**
 * Pages with no voice control on them.
 *
 * Light is mounted at the root now, so it exists on every page — but existing
 * and being ON SCREEN are different questions. A microphone button has no
 * business on the marketing front page or in the middle of signing in, and the
 * lazy chunk should not be fetched by a visitor who has not reached the app.
 *
 * Everything not listed keeps it, including community, apps, learn and store —
 * those are the trips it used to die on.
 */
const NO_LIGHT = ['/sign-in', '/sign-up', '/legal', '/download', '/embed']

// ssr:false as before — it reaches for the microphone and speech APIs, neither
// of which exists on the server.
const VoiceControl = nextDynamic(() => import('@/components/editor/daw/VoiceControl'), { ssr: false })

export default function LightMount() {
  const slot = useLightSlot()
  const path = usePathname()
  const [ready, setReady] = useState(false)
  // Portals need a DOM, so nothing renders until after hydration.
  useEffect(() => { setReady(true) }, [])
  if (!ready) return null

  // The front page is the one route that must match exactly — every other
  // path begins with '/' and would match a prefix test.
  if (path === '/' || NO_LIGHT.some(p => path === p || path.startsWith(p + '/'))) return null

  // ⚠️ ONE MICROPHONE PER APP, and a desktop module window is not a second app.
  // Electron opens each module as its own window on /apps/<key>. Those used to
  // sit outside the app layout, which is what kept Light out of them; now that
  // Light is mounted at the root, only this keeps a five-window desktop session
  // from having five microphones in it, each able to hear the others.
  // In a BROWSER /apps/* is an ordinary page and keeps its Light.
  const desktop = typeof window !== 'undefined'
    && !!(window as unknown as { electronAPI?: { isElectron?: boolean } }).electronAPI?.isElectron
  if (desktop && path.startsWith('/apps/')) return null

  // In the studio: inside the transport bar, where it has always been.
  if (slot) return createPortal(<VoiceControl />, slot)

  // Everywhere else: its own corner. Above the page, below any modal — a voice
  // control that sits on top of a dialog is a voice control in the way.
  return (
    <div style={{ position: 'fixed', right: 18, bottom: 18, zIndex: 120 }}>
      <VoiceControl />
    </div>
  )
}
