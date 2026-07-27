'use client'

// Article-scoped shared state so a reader can set tempo and key once and every
// widget below follows. A page-wide React context (reset automatically per
// article). Widgets only follow the shared values once a @setup widget has
// mounted (`active`); without one they keep their own hand-tuned defaults.

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'

export type ArticleState = {
  tempo: number
  root: number          // 0..11 semitones from C
  active: boolean       // a @setup widget is present → widgets should follow
  setTempo: (n: number) => void
  setRoot: (n: number) => void
  activate: () => void
}

const DEFAULT: ArticleState = { tempo: 120, root: 0, active: false, setTempo: () => {}, setRoot: () => {}, activate: () => {} }
const Ctx = createContext<ArticleState>(DEFAULT)

export function ArticleStateProvider({ children }: { children: React.ReactNode }) {
  const [s, setS] = useState({ tempo: 120, root: 0, active: false })
  const setTempo = useCallback((n: number) => setS(v => ({ ...v, tempo: n, active: true })), [])
  const setRoot = useCallback((n: number) => setS(v => ({ ...v, root: n, active: true })), [])
  const activate = useCallback(() => setS(v => (v.active ? v : { ...v, active: true })), [])
  return <Ctx.Provider value={{ ...s, setTempo, setRoot, activate }}>{children}</Ctx.Provider>
}

export function useArticleState() { return useContext(Ctx) }

/** Tempo a widget should use: the shared one if a @setup is present, else its own. */
export function useSharedTempo(fallback: number): number {
  const { tempo, active } = useArticleState()
  return active ? tempo : fallback
}

/** Root-note semitone offset (0 = C) a widget should use, else its own default. */
export function useSharedRoot(fallback = 0): number {
  const { root, active } = useArticleState()
  return active ? root : fallback
}

/** Call from a @setup widget so widgets below know to follow the shared values. */
export function useActivateShared() {
  const { activate } = useArticleState()
  useEffect(() => { activate() }, [activate])
}

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
