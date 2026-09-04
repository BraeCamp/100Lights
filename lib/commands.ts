'use client'

// Command registry — a framework-light store of runnable commands that powers
// the ⌘K command palette. Editors register their existing handlers as commands
// (a NEW way to trigger EXISTING actions); the palette reads them here.
//
// Design mirrors lib/perf-mode: a module-level store + useSyncExternalStore, so
// any component can register/read commands without prop-drilling or context.

import { useEffect, useSyncExternalStore } from 'react'

export interface Command {
  /** Stable unique id. Re-registering the same id replaces the prior command. */
  id: string
  /** Human label shown in the palette. */
  label: string
  /** Optional group heading (e.g. "Navigate", "Video"). */
  group?: string
  /** Extra searchable terms (space-separated) folded into the filter. */
  keywords?: string
  /** What the command does. */
  run: () => void
  /** Hide the command when this returns false (e.g. edit-only actions). */
  when?: () => boolean
  /** Display-only shortcut hint, right-aligned (e.g. "⌘S"). */
  shortcut?: string
}

// Insertion-ordered store keyed by id (dedupe: later registration wins).
const store = new Map<string, Command>()
const listeners = new Set<() => void>()

// Cached snapshot so getSnapshot returns a stable reference between changes
// (useSyncExternalStore tears/loops if the array identity changes every call).
let snapshot: Command[] = []
const EMPTY: Command[] = []

function rebuild() {
  snapshot = Array.from(store.values())
}

function emit() {
  for (const l of listeners) l()
}

/**
 * Register a batch of commands. Returns an unregister fn that removes exactly
 * the commands it added (only if a newer registration hasn't since replaced
 * that id, so late unmounts don't clobber a fresh registration).
 */
export function registerCommands(cmds: Command[]): () => void {
  for (const c of cmds) store.set(c.id, c)
  rebuild()
  emit()
  return () => {
    let changed = false
    for (const c of cmds) {
      if (store.get(c.id) === c) {
        store.delete(c.id)
        changed = true
      }
    }
    if (changed) {
      rebuild()
      emit()
    }
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** Reactive list of all registered commands. SSR-safe (empty on the server). */
/** Every registered command, right now — for readers that are not components
 *  (the voice control matches what was said against these labels). */
export function listCommands(): Command[] {
  return snapshot
}

export function useCommands(): Command[] {
  return useSyncExternalStore(subscribe, () => snapshot, () => EMPTY)
}

/**
 * Register `cmds` on mount / whenever `deps` change, and unregister on cleanup.
 * Keep the command objects fresh in `deps` so closures capture current state.
 */
export function useRegisterCommands(cmds: Command[], deps: unknown[]): void {
  useEffect(() => {
    return registerCommands(cmds)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
