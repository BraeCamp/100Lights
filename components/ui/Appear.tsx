'use client'

import React from 'react'
import { useMountTransition } from '@/lib/ui/popup'

/**
 * Show or hide something with a transition, both ways.
 *
 * Brae: "Add more transitions throughout the app. Smooth transitions create
 * trust and we need things appearing and disappearing to have smooth
 * transitions."
 *
 * ⚠️ THE EXIT IS THE HALF THAT WAS MISSING. `{open && <Thing/>}` unmounts on
 * close, and an element that is gone cannot fade — so most things opened with
 * a small settle and vanished with a cut. This keeps the element mounted for
 * the length of the exit and hands it the right class, so both directions
 * read as the same motion. Compositor-only (opacity + transform), so it costs
 * nothing measurable. Honours prefers-reduced-motion via the classes.
 *
 *   <Appear show={open} kind="rise">{cls => <div className={cls}>…</div>}</Appear>
 *
 * The render-prop form puts the class on YOUR element (right for anything
 * position: fixed / absolute — a wrapper div would break its placement). The
 * plain-children form wraps in a div for things that flow.
 *
 * kind: fade  — opacity only (overlays, hints, banners)
 *       rise  — up 6px + fade (toasts and status pills at the bottom)
 *       drop  — down 4px + fade (things that hang from a bar)
 *       pop   — the menu pop used by popovers (from lib/ui/popup.ts)
 *       pop-up — the same, growing upward
 *       grow  — scaleY from the top + fade (sections that expand under a row)
 */
export type AppearKind = 'fade' | 'rise' | 'drop' | 'pop' | 'pop-up' | 'grow'

const CLASS: Record<AppearKind, [string, string]> = {
  fade:     ['appear-fade', 'appear-fade-out'],
  rise:     ['appear-rise', 'appear-rise-out'],
  drop:     ['appear-drop', 'appear-drop-out'],
  pop:      ['menu-pop', 'menu-pop-out'],
  'pop-up': ['menu-pop-up', 'menu-pop-up-out'],
  grow:     ['appear-grow', 'appear-grow-out'],
}

export function appearClass(kind: AppearKind, leaving: boolean): string {
  return CLASS[kind][leaving ? 1 : 0]
}

/**
 * The last value that was there. A toast fading out must keep showing the
 * message it was showing — its state has already been cleared by then, and a
 * blank "  is editing this clip" for the length of the fade is worse than a
 * cut.
 */
export function useSticky<T>(value: T): T {
  const last = React.useRef(value)
  if (value) last.current = value
  return value || last.current
}

/**
 * The same thing as a hook, for a `{open && (…)}` that is awkward to wrap.
 *
 *   const menu = useAppear(open, 'pop')
 *   {menu.mounted && <div className={menu.cls}>…</div>}
 *
 * Only the condition and the element's className change; the closing of the
 * block does not, which is what makes retrofitting a hundred of these safe.
 */
export function useAppear(show: boolean, kind: AppearKind = 'fade', exitMs = 140): { mounted: boolean; leaving: boolean; cls: string } {
  const { mounted, leaving } = useMountTransition(show, exitMs)
  return { mounted, leaving, cls: appearClass(kind, leaving) }
}

export default function Appear({
  show, kind = 'fade', exitMs = 140, children, className, style,
}: {
  show: boolean
  kind?: AppearKind
  /** How long the exit class is held before unmount. Match the CSS. */
  exitMs?: number
  children: React.ReactNode | ((cls: string, leaving: boolean) => React.ReactNode)
  /** Only for the wrapping form. */
  className?: string
  style?: React.CSSProperties
}) {
  const { mounted, leaving } = useMountTransition(show, exitMs)
  if (!mounted) return null
  const cls = appearClass(kind, leaving)
  if (typeof children === 'function') return <>{children(cls, leaving)}</>
  return <div className={`${cls}${className ? ` ${className}` : ''}`} style={style}>{children}</div>
}
