'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The one toast. Five admin panels had a byte-identical copy of this with
 * timeouts that had drifted apart (2600ms in two, 3000ms in three), and four
 * more components hand-rolled their own.
 *
 *   const { toast, showToast } = useToast()
 *   ...
 *   showToast('Saved')
 *   return <>{...}<Toast message={toast} /></>
 *
 * Fixes a bug all the copies shared: they called setTimeout without clearing
 * the previous one, so two toasts in quick succession left the first timer
 * running and it would hide the second message early.
 */
export function useToast(ms = 3000) {
  const [toast, setToast] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((message: string) => {
    if (timer.current) clearTimeout(timer.current)
    setToast(message)
    timer.current = setTimeout(() => { setToast(null); timer.current = null }, ms)
  }, [ms])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  return { toast, showToast }
}

/**
 * `zIndex` defaults to 9001, which is what four of the five copies used. Pass a
 * higher value where the toast has to clear a modal — UsersPanel uses 9600.
 *
 * pointerEvents: 'none' came from the UsersPanel copy and is applied to all of
 * them now: a toast that swallows clicks in the corner of the screen is a bug
 * everywhere, not a UsersPanel quirk.
 */
export function Toast({ message, zIndex = 9001 }: { message: string | null; zIndex?: number }) {
  if (!message) return null
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed', bottom: 24, right: 24, zIndex,
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 10, padding: '10px 16px', fontSize: 13,
        color: 'var(--text-primary)', boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        pointerEvents: 'none',
      }}
    >
      {message}
    </div>
  )
}
