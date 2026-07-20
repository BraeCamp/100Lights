'use client'

/**
 * Defers an article widget's JavaScript until the reader scrolls near it.
 *
 * Two things matter here for SEO, and they pull in opposite directions:
 * the page must be fast, and the page must be full of real text. So the
 * server renders a static version of every widget (chord names, captions —
 * see `simple-markdown.tsx`), that markup is what crawlers and no-JS readers
 * get, and it stays on screen until the interactive version is both needed
 * and downloaded. Nothing swaps out underneath a reader who never scrolls.
 *
 * The widget code lives behind a dynamic `import()`, so an article that uses
 * no widgets ships none of this, and one that uses a piano doesn't pay for
 * the sound embed.
 */

import React, { useEffect, useRef, useState } from 'react'
import type { ProgressionData } from '@/components/ArticleProgression'

// Static map, not a computed specifier — the bundler needs literals to split
// these into their own chunks.
const LOADERS = {
  sound: () => import('@/components/ArticleSoundEmbed'),
  progression: () => import('@/components/ArticleProgression'),
} as const

export type WidgetKind = keyof typeof LOADERS

/** Callers are prop-checked per kind; the cast is confined to the render. */
type WidgetSpec =
  | { kind: 'sound'; props: { itemId: string; caption: string } }
  | { kind: 'progression'; props: { data: ProgressionData } }

type AnyWidget = React.ComponentType<Record<string, unknown>>

export default function LazyArticleWidget({
  kind,
  props,
  children,
}: WidgetSpec & { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [Widget, setWidget] = useState<AnyWidget | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = () => {
      LOADERS[kind]()
        .then(m => { if (!cancelled) setWidget(() => m.default as unknown as AnyWidget) })
        .catch(() => { /* keep the static fallback — a dead chunk shouldn't blank the article */ })
    }

    // No observer (old browser, jsdom): just load, rather than leaving the
    // reader with a permanently inert placeholder.
    if (typeof IntersectionObserver === 'undefined') {
      load()
      return () => { cancelled = true }
    }

    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      entries => {
        if (!entries.some(e => e.isIntersecting)) return
        io.disconnect()
        load()
      },
      // Start fetching a screenful early so the swap has usually happened by
      // the time the widget is actually looked at.
      { rootMargin: '500px 0px' },
    )
    io.observe(el)
    return () => { cancelled = true; io.disconnect() }
  }, [kind])

  return (
    <div ref={ref}>
      {Widget ? <Widget {...(props as Record<string, unknown>)} /> : children}
    </div>
  )
}
