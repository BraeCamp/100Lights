'use client'

// Reusable drag-and-drop for media files, shared across modules so every drop target
// behaves the same: only reacts to OS file drags (not internal element drags), filters to
// accepted media kinds, and reports an `isOver` flag for a highlight ring.
//
//   const { isOver, dropProps } = useMediaDrop(files => files.forEach(importFile), { accept: ['audio', 'video'] })
//   <div {...dropProps} style={{ outline: isOver ? '2px solid var(--accent)' : 'none' }} />

import { useCallback, useRef, useState } from 'react'
import { detectMediaKind, type MediaKind } from './media-import'

interface Options { accept?: MediaKind[] }

export function useMediaDrop(onFiles: (files: File[]) => void, opts?: Options) {
  const [isOver, setOver] = useState(false)
  const depth = useRef(0)   // enter/leave fire per child; count depth so the ring doesn't flicker
  const accept = opts?.accept

  // Only engage for real file drags — internal drags (library entries, folders) carry
  // custom types, not 'Files', so they pass straight through to their own handlers.
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types || []).includes('Files')

  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault(); depth.current += 1; setOver(true)
  }, [])
  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy'
  }, [])
  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e)) return
    depth.current = Math.max(0, depth.current - 1); if (depth.current === 0) setOver(false)
  }, [])
  const onDrop = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault(); depth.current = 0; setOver(false)
    const files = Array.from(e.dataTransfer.files).filter(f => {
      const k = detectMediaKind(f)
      return !!k && (!accept || accept.includes(k))
    })
    if (files.length) onFiles(files)
  }, [onFiles, accept])

  return { isOver, dropProps: { onDragEnter, onDragOver, onDragLeave, onDrop } }
}
