'use client'

import { useState, useRef, useEffect } from 'react'
import {
  MousePointer2, Square, Type, ImageIcon, Download, ChevronDown,
  Trash2, ArrowLeft, Eye, EyeOff, Copy,
  AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  Minus, Plus, Maximize2, Circle, GripVertical,
} from 'lucide-react'
import Link from 'next/link'

// ── Types ──────────────────────────────────────────────────────

type RectLayer = {
  id: string
  kind: 'rect'
  name: string
  x: number
  y: number
  width: number
  height: number
  fill: string
  opacity: number
  borderRadius?: number
  strokeColor?: string
  strokeWidth?: number
  hidden?: boolean
  shadowColor?: string
  shadowBlur?: number
  shadowX?: number
  shadowY?: number
}

type EllipseLayer = {
  id: string
  kind: 'ellipse'
  name: string
  x: number
  y: number
  width: number
  height: number
  fill: string
  opacity: number
  strokeColor?: string
  strokeWidth?: number
  hidden?: boolean
  shadowColor?: string
  shadowBlur?: number
  shadowX?: number
  shadowY?: number
}

type TextLayer = {
  id: string
  kind: 'text'
  name: string
  x: number
  y: number
  text: string
  fontSize: number
  color: string
  fontWeight: string
  fontFamily?: string
  textAlign?: 'left' | 'center' | 'right'
  letterSpacing?: number
  opacity?: number
  hidden?: boolean
}

type ImageLayer = {
  id: string
  kind: 'image'
  name: string
  x: number
  y: number
  width: number
  height: number
  src: string
  opacity?: number
  hidden?: boolean
  shadowColor?: string
  shadowBlur?: number
  shadowX?: number
  shadowY?: number
}

type Layer = RectLayer | EllipseLayer | TextLayer | ImageLayer

type Tool = 'select' | 'rect' | 'ellipse' | 'text'

interface CanvasPreset {
  label: string
  width: number
  height: number
}

const PRESETS: CanvasPreset[] = [
  { label: 'YouTube 16:9 (1280×720)', width: 1280, height: 720 },
  { label: 'Instagram 1:1 (1080×1080)', width: 1080, height: 1080 },
  { label: 'Twitter/X (1200×628)', width: 1200, height: 628 },
  { label: 'OG Image (1200×630)', width: 1200, height: 630 },
]

const FONT_FAMILIES = [
  { label: 'System UI', value: 'system-ui, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Courier New', value: 'Courier New, monospace' },
  { label: 'Impact', value: 'Impact, sans-serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
]

// ── Helpers ────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

function getLayerDims(layer: Layer): { w: number; h: number } {
  if (layer.kind === 'rect' || layer.kind === 'image' || layer.kind === 'ellipse') {
    return { w: layer.width, h: layer.height }
  }
  return {
    w: Math.max(50, layer.fontSize * layer.text.length * 0.6),
    h: layer.fontSize * 1.2,
  }
}

// ── Shared input style ─────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '5px 8px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg-card)',
  color: 'var(--text-primary)',
  fontSize: 12,
  outline: 'none',
  boxSizing: 'border-box',
}

// ── Props ──────────────────────────────────────────────────────

export interface ImageEditorProps {
  projectId?: string
  projectName: string
  onProjectNameCommit?: (name: string) => void
}

// ── Component ──────────────────────────────────────────────────

export default function ImageEditor({ projectName, onProjectNameCommit }: ImageEditorProps) {
  const ACCENT = '#ec4899'

  const [canvasW, setCanvasW] = useState(1200)
  const [canvasH, setCanvasH] = useState(630)
  const [layers, setLayers] = useState<Layer[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tool, setTool] = useState<Tool>('select')
  const [editingName, setEditingName] = useState(false)
  const [localName, setLocalName] = useState(projectName)
  const [showPresets, setShowPresets] = useState(false)
  const [showCustomSize, setShowCustomSize] = useState(false)
  const [customW, setCustomW] = useState(1200)
  const [customH, setCustomH] = useState(630)
  const [dragging, setDragging] = useState<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null)
  const [resizing, setResizing] = useState<{
    id: string; handle: string; startX: number; startY: number
    origX: number; origY: number; origW: number; origH: number
    origFontSize?: number
  } | null>(null)
  const [drawing, setDrawing] = useState<{ startX: number; startY: number; tool: 'rect' | 'ellipse' } | null>(null)
  const [drawPreview, setDrawPreview] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [bgColor, setBgColor] = useState('#ffffff')
  const [showBgPicker, setShowBgPicker] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [scale, setScale] = useState(1)
  const [editingTextId, setEditingTextId] = useState<string | null>(null)
  const [dragOverLayerId, setDragOverLayerId] = useState<string | null>(null)
  const [renamingLayerId, setRenamingLayerId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const containerRef = useRef<HTMLDivElement>(null)
  const canvasAreaRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const exportCanvasRef = useRef<HTMLCanvasElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const dragLayerIdRef = useRef<string | null>(null)
  const clipboardRef = useRef<Layer | null>(null)

  const undoHistory = useRef<Layer[][]>([])
  const redoHistory = useRef<Layer[][]>([])

  const rectCountRef = useRef(0)
  const ellipseCountRef = useRef(0)
  const textCountRef = useRef(0)
  const imageCountRef = useRef(0)

  const selected = layers.find(l => l.id === selectedId) ?? null

  // ── Scale to fit canvas in viewport ───────────────────────

  useEffect(() => {
    function updateScale() {
      if (!canvasAreaRef.current) return
      const availW = canvasAreaRef.current.clientWidth - 64
      const availH = canvasAreaRef.current.clientHeight - 64
      const s = Math.min(availW / canvasW, availH / canvasH, 1)
      setScale(Math.max(s, 0.1))
    }
    updateScale()
    const ro = new ResizeObserver(updateScale)
    if (canvasAreaRef.current) ro.observe(canvasAreaRef.current)
    return () => ro.disconnect()
  }, [canvasW, canvasH])

  // ── Focus contenteditable when entering text edit mode ────

  useEffect(() => {
    if (!editingTextId) return
    const el = document.querySelector(`[data-edit-id="${editingTextId}"]`) as HTMLDivElement | null
    if (!el) return
    el.focus()
    const range = document.createRange()
    const sel = window.getSelection()
    range.selectNodeContents(el)
    range.collapse(false)
    sel?.removeAllRanges()
    sel?.addRange(range)
  }, [editingTextId])

  // ── History ────────────────────────────────────────────────

  function saveHistory() {
    undoHistory.current = [...undoHistory.current.slice(-49), [...layers]]
    redoHistory.current = []
  }

  function undo() {
    if (!undoHistory.current.length) return
    const prev = undoHistory.current[undoHistory.current.length - 1]
    undoHistory.current = undoHistory.current.slice(0, -1)
    redoHistory.current = [...redoHistory.current, [...layers]]
    setLayers(prev)
    setSelectedId(null)
  }

  function redo() {
    if (!redoHistory.current.length) return
    const next = redoHistory.current[redoHistory.current.length - 1]
    redoHistory.current = redoHistory.current.slice(0, -1)
    undoHistory.current = [...undoHistory.current, [...layers]]
    setLayers(next)
    setSelectedId(null)
  }

  // ── Layer mutations ────────────────────────────────────────

  function updateLayer(id: string, patch: Partial<Layer>) {
    setLayers(ls => ls.map(l => l.id === id ? { ...l, ...patch } as Layer : l))
  }

  function deleteSelected() {
    if (!selectedId) return
    saveHistory()
    setLayers(ls => ls.filter(l => l.id !== selectedId))
    setSelectedId(null)
  }

  function duplicateSelected() {
    if (!selected) return
    saveHistory()
    const newId = uid()
    let newName = selected.name
    if (selected.kind === 'rect') newName = `Rectangle ${++rectCountRef.current}`
    else if (selected.kind === 'ellipse') newName = `Ellipse ${++ellipseCountRef.current}`
    else if (selected.kind === 'text') newName = `Text ${++textCountRef.current}`
    else newName = `Image ${++imageCountRef.current}`
    const newLayer: Layer = { ...selected, id: newId, x: selected.x + 20, y: selected.y + 20, name: newName } as Layer
    setLayers(ls => [...ls, newLayer])
    setSelectedId(newId)
  }

  // ── Canvas coords ──────────────────────────────────────────

  function canvasCoords(e: React.PointerEvent): { x: number; y: number } {
    const el = e.currentTarget as HTMLDivElement
    const rect = el.getBoundingClientRect()
    return {
      x: Math.round((e.clientX - rect.left) / (scale * zoom)),
      y: Math.round((e.clientY - rect.top) / (scale * zoom)),
    }
  }

  // ── Tool: pointer events on the canvas ────────────────────

  function onCanvasPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (tool === 'rect' || tool === 'ellipse') {
      const { x, y } = canvasCoords(e)
      setDrawing({ startX: x, startY: y, tool })
      try { (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId) } catch {}
      setSelectedId(null)
      return
    }
    if (tool === 'text') {
      const { x, y } = canvasCoords(e)
      const id = uid()
      const name = `Text ${++textCountRef.current}`
      saveHistory()
      const layer: TextLayer = {
        id, kind: 'text', name,
        x, y,
        text: 'Text', fontSize: 32, color: '#1a1a1a', fontWeight: '600',
        fontFamily: 'system-ui, sans-serif', textAlign: 'left', letterSpacing: 0,
        opacity: 100,
      }
      setLayers(ls => [...ls, layer])
      setSelectedId(id)
      setTool('select')
      return
    }
    setSelectedId(null)
  }

  function onCanvasPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!drawing) return
    const { x, y } = canvasCoords(e)
    const px = Math.min(drawing.startX, x)
    const py = Math.min(drawing.startY, y)
    const pw = Math.abs(x - drawing.startX)
    const ph = Math.abs(y - drawing.startY)
    setDrawPreview({ x: px, y: py, w: pw, h: ph })
  }

  function onCanvasPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (drawing && drawPreview && drawPreview.w > 4 && drawPreview.h > 4) {
      const id = uid()
      saveHistory()
      if (drawing.tool === 'rect') {
        const name = `Rectangle ${++rectCountRef.current}`
        const layer: RectLayer = {
          id, kind: 'rect', name,
          x: drawPreview.x, y: drawPreview.y,
          width: drawPreview.w, height: drawPreview.h,
          fill: '#ec4899', opacity: 100,
          borderRadius: 0, strokeColor: '#000000', strokeWidth: 0,
        }
        setLayers(ls => [...ls, layer])
      } else {
        const name = `Ellipse ${++ellipseCountRef.current}`
        const layer: EllipseLayer = {
          id, kind: 'ellipse', name,
          x: drawPreview.x, y: drawPreview.y,
          width: drawPreview.w, height: drawPreview.h,
          fill: '#ec4899', opacity: 100,
          strokeColor: '#000000', strokeWidth: 0,
        }
        setLayers(ls => [...ls, layer])
      }
      setSelectedId(id)
      setTool('select')
    }
    setDrawing(null)
    setDrawPreview(null)
  }

  // ── Layer drag ─────────────────────────────────────────────

  function onLayerPointerDown(e: React.PointerEvent<HTMLDivElement>, id: string) {
    if (tool !== 'select') return
    e.stopPropagation()
    setSelectedId(id)
    // Double-click on text layer enters inline edit mode
    if (e.detail >= 2) {
      const layer = layers.find(l => l.id === id)
      if (layer?.kind === 'text') {
        setEditingTextId(id)
        return
      }
    }
    const layer = layers.find(l => l.id === id)
    if (!layer) return
    ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
    saveHistory()
    setDragging({ id, startX: e.clientX, startY: e.clientY, origX: layer.x, origY: layer.y })
  }

  function onLayerPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return
    const dx = Math.round((e.clientX - dragging.startX) / (scale * zoom))
    const dy = Math.round((e.clientY - dragging.startY) / (scale * zoom))
    updateLayer(dragging.id, { x: dragging.origX + dx, y: dragging.origY + dy } as Partial<Layer>)
  }

  function onLayerPointerUp() {
    setDragging(null)
  }

  // ── Resize handles ─────────────────────────────────────────

  function onResizeHandlePointerDown(e: React.PointerEvent<HTMLDivElement>, handle: string) {
    if (tool !== 'select') return
    e.stopPropagation()
    if (!selected) return
    ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
    saveHistory()
    const { w, h } = getLayerDims(selected)
    setResizing({
      id: selected.id,
      handle,
      startX: e.clientX,
      startY: e.clientY,
      origX: selected.x,
      origY: selected.y,
      origW: w,
      origH: h,
      origFontSize: selected.kind === 'text' ? selected.fontSize : undefined,
    })
  }

  function onResizePointerMove(e: React.PointerEvent) {
    if (!resizing) return
    const dx = (e.clientX - resizing.startX) / (scale * zoom)
    const dy = (e.clientY - resizing.startY) / (scale * zoom)

    let newX = resizing.origX
    let newY = resizing.origY
    let newW = resizing.origW
    let newH = resizing.origH

    const h = resizing.handle
    if (h === 'tl' || h === 'ml' || h === 'bl') { newX = resizing.origX + dx; newW = resizing.origW - dx }
    if (h === 'tr' || h === 'mr' || h === 'br') { newW = resizing.origW + dx }
    if (h === 'tl' || h === 'tc' || h === 'tr') { newY = resizing.origY + dy; newH = resizing.origH - dy }
    if (h === 'bl' || h === 'bc' || h === 'br') { newH = resizing.origH + dy }

    newW = Math.max(4, newW)
    newH = Math.max(4, newH)

    if (resizing.origFontSize !== undefined) {
      // text layer — resize by changing fontSize proportionally
      const ratio = newH / resizing.origH
      const newFontSize = Math.max(8, Math.round(resizing.origFontSize * ratio))
      updateLayer(resizing.id, { x: Math.round(newX), y: Math.round(newY), fontSize: newFontSize } as Partial<Layer>)
    } else {
      updateLayer(resizing.id, {
        x: Math.round(newX), y: Math.round(newY),
        width: Math.round(newW), height: Math.round(newH),
      } as Partial<Layer>)
    }
  }

  function onResizePointerUp() {
    setResizing(null)
  }

  // ── Image upload ───────────────────────────────────────────

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const src = ev.target?.result as string
      const img = new window.Image()
      img.onload = () => {
        const maxW = Math.min(canvasW * 0.6, img.naturalWidth)
        const ratio = img.naturalHeight / img.naturalWidth
        const w = Math.round(maxW)
        const h = Math.round(maxW * ratio)
        const id = uid()
        const name = `Image ${++imageCountRef.current}`
        saveHistory()
        const layer: ImageLayer = {
          id, kind: 'image', name,
          x: Math.round((canvasW - w) / 2), y: Math.round((canvasH - h) / 2),
          width: w, height: h, src, opacity: 100,
        }
        setLayers(ls => [...ls, layer])
        setSelectedId(id)
      }
      img.src = src
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  // ── Export ─────────────────────────────────────────────────

  async function exportAs(format: 'png' | 'jpeg' | 'webp') {
    const canvas = exportCanvasRef.current
    if (!canvas) return
    canvas.width = canvasW
    canvas.height = canvasH
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Pre-load all image layer sources before drawing
    const imageMap = new Map<string, HTMLImageElement>()
    await Promise.all(
      layers.filter(l => l.kind === 'image' && !l.hidden).map(l => new Promise<void>(resolve => {
        const img = new window.Image()
        img.onload = () => { imageMap.set(l.id, img); resolve() }
        img.onerror = () => resolve()
        img.src = (l as ImageLayer).src
      }))
    )

    ctx.fillStyle = bgColor
    ctx.fillRect(0, 0, canvasW, canvasH)

    for (const layer of layers) {
      if (layer.hidden) continue
      ctx.save()
      if (layer.kind === 'rect') {
        ctx.globalAlpha = (layer.opacity ?? 100) / 100
        const r = layer.borderRadius ?? 0
        ctx.fillStyle = layer.fill
        if (layer.shadowBlur || layer.shadowX || layer.shadowY) {
          ctx.shadowColor = layer.shadowColor ?? '#000000'
          ctx.shadowBlur = layer.shadowBlur ?? 0
          ctx.shadowOffsetX = layer.shadowX ?? 0
          ctx.shadowOffsetY = layer.shadowY ?? 0
        }
        if (r > 0) {
          ctx.beginPath()
          ctx.roundRect(layer.x, layer.y, layer.width, layer.height, r)
          ctx.fill()
        } else {
          ctx.fillRect(layer.x, layer.y, layer.width, layer.height)
        }
        ctx.shadowColor = 'transparent'
        ctx.shadowBlur = 0
        ctx.shadowOffsetX = 0
        ctx.shadowOffsetY = 0
        const sw = layer.strokeWidth ?? 0
        if (sw > 0) {
          ctx.strokeStyle = layer.strokeColor ?? '#000000'
          ctx.lineWidth = sw
          if (r > 0) {
            ctx.beginPath()
            ctx.roundRect(layer.x, layer.y, layer.width, layer.height, r)
            ctx.stroke()
          } else {
            ctx.strokeRect(layer.x, layer.y, layer.width, layer.height)
          }
        }
      } else if (layer.kind === 'ellipse') {
        ctx.globalAlpha = (layer.opacity ?? 100) / 100
        const cx = layer.x + layer.width / 2
        const cy = layer.y + layer.height / 2
        const rx = layer.width / 2
        const ry = layer.height / 2
        ctx.fillStyle = layer.fill
        if (layer.shadowBlur || layer.shadowX || layer.shadowY) {
          ctx.shadowColor = layer.shadowColor ?? '#000000'
          ctx.shadowBlur = layer.shadowBlur ?? 0
          ctx.shadowOffsetX = layer.shadowX ?? 0
          ctx.shadowOffsetY = layer.shadowY ?? 0
        }
        ctx.beginPath()
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.shadowColor = 'transparent'
        ctx.shadowBlur = 0
        ctx.shadowOffsetX = 0
        ctx.shadowOffsetY = 0
        const sw = layer.strokeWidth ?? 0
        if (sw > 0) {
          ctx.strokeStyle = layer.strokeColor ?? '#000000'
          ctx.lineWidth = sw
          ctx.beginPath()
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
          ctx.stroke()
        }
      } else if (layer.kind === 'text') {
        ctx.globalAlpha = (layer.opacity ?? 100) / 100
        ctx.fillStyle = layer.color
        const ff = layer.fontFamily ?? 'system-ui, sans-serif'
        ctx.font = `${layer.fontWeight} ${layer.fontSize}px ${ff}`
        ctx.textAlign = layer.textAlign ?? 'left'
        ctx.fillText(layer.text, layer.x, layer.y + layer.fontSize)
      } else if (layer.kind === 'image') {
        ctx.globalAlpha = (layer.opacity ?? 100) / 100
        const img = imageMap.get(layer.id)
        if (img) ctx.drawImage(img, layer.x, layer.y, layer.width, layer.height)
      }
      ctx.restore()
    }

    const mimeType = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png'
    const quality = format === 'png' ? undefined : 0.9
    const slug = localName.replace(/\s+/g, '-').toLowerCase()
    canvas.toBlob(blob => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${slug}.${format}`
      a.click()
      URL.revokeObjectURL(url)
    }, mimeType, quality)
  }

  // ── Keyboard shortcuts ─────────────────────────────────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return
      if ((e.target as HTMLElement).isContentEditable) return
      if (e.key === 'Backspace' || e.key === 'Delete') deleteSelected()
      if ((e.key === 'v' && !e.metaKey && !e.ctrlKey) || e.key === 'Escape') setTool('select')
      if (e.key === 'r') setTool('rect')
      if (e.key === 'e') setTool('ellipse')
      if (e.key === 't') setTool('text')
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault()
        undo()
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'z') {
        e.preventDefault()
        redo()
      }
      // Arrow nudge
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (selectedId) {
          const layer = layers.find(l => l.id === selectedId)
          if (layer) {
            e.preventDefault()
            const dist = e.shiftKey ? 10 : 1
            if (e.key === 'ArrowLeft') updateLayer(selectedId, { x: layer.x - dist } as Partial<Layer>)
            if (e.key === 'ArrowRight') updateLayer(selectedId, { x: layer.x + dist } as Partial<Layer>)
            if (e.key === 'ArrowUp') updateLayer(selectedId, { y: layer.y - dist } as Partial<Layer>)
            if (e.key === 'ArrowDown') updateLayer(selectedId, { y: layer.y + dist } as Partial<Layer>)
          }
        }
      }
      // Copy
      if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
        const layer = layers.find(l => l.id === selectedId)
        if (layer) clipboardRef.current = { ...layer }
      }
      // Paste
      if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
        const clip = clipboardRef.current
        if (clip) {
          saveHistory()
          const newId = uid()
          let newName = clip.name
          if (clip.kind === 'rect') newName = `Rectangle ${++rectCountRef.current}`
          else if (clip.kind === 'ellipse') newName = `Ellipse ${++ellipseCountRef.current}`
          else if (clip.kind === 'text') newName = `Text ${++textCountRef.current}`
          else newName = `Image ${++imageCountRef.current}`
          const newLayer: Layer = { ...clip, id: newId, x: clip.x + 20, y: clip.y + 20, name: newName }
          setLayers(ls => [...ls, newLayer])
          setSelectedId(newId)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, layers]) // eslint-disable-line

  // ── Properties panel ──────────────────────────────────────

  function PropertiesPanel() {
    if (!selected) {
      return (
        <div style={{ padding: '20px 16px', color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>
          Select a layer to edit its properties
        </div>
      )
    }

    const { w: layerW, h: layerH } = getLayerDims(selected)

    function sectionLabel(title: string) {
      return (
        <div style={{
          fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: 'var(--text-muted)',
          padding: '8px 0 4px',
          borderTop: '1px solid var(--border)',
        }}>
          {title}
        </div>
      )
    }

    function alignBtn(Icon: React.ComponentType<{ size?: number }>, title: string, onClick: () => void) {
      return (
        <button
          key={title}
          title={title}
          onClick={onClick}
          style={{
            padding: '4px 6px', borderRadius: 5,
            border: '1px solid var(--border)',
            background: 'transparent', color: 'var(--text-muted)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = ACCENT }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)' }}
        >
          <Icon size={13} />
        </button>
      )
    }

    return (
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Layer type label */}
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          {selected.kind === 'rect' ? 'Rectangle' : selected.kind === 'ellipse' ? 'Ellipse' : selected.kind === 'text' ? 'Text' : 'Image'}
          {' '}<span style={{ fontWeight: 400, textTransform: 'none' }}>— {selected.name}</span>
        </div>

        {/* Position & Size */}
        {sectionLabel('Position & Size')}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>X</span>
            <input type="number" value={selected.x} onChange={e => updateLayer(selected.id, { x: Number(e.target.value) } as Partial<Layer>)} style={inputStyle} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Y</span>
            <input type="number" value={selected.y} onChange={e => updateLayer(selected.id, { y: Number(e.target.value) } as Partial<Layer>)} style={inputStyle} />
          </label>
        </div>
        {(selected.kind === 'rect' || selected.kind === 'image' || selected.kind === 'ellipse') && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>W</span>
              <input type="number" value={selected.width} onChange={e => updateLayer(selected.id, { width: Number(e.target.value) } as Partial<Layer>)} style={inputStyle} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>H</span>
              <input type="number" value={selected.height} onChange={e => updateLayer(selected.id, { height: Number(e.target.value) } as Partial<Layer>)} style={inputStyle} />
            </label>
          </div>
        )}

        {/* Appearance — rect */}
        {selected.kind === 'rect' && (
          <>
            {sectionLabel('Appearance')}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Fill</span>
                <input
                  type="color" value={selected.fill}
                  onChange={e => updateLayer(selected.id, { fill: e.target.value } as Partial<Layer>)}
                  style={{ ...inputStyle, padding: 2, height: 30, cursor: 'pointer' }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Radius</span>
                <input
                  type="number" min={0} max={500}
                  value={selected.borderRadius ?? 0}
                  onChange={e => updateLayer(selected.id, { borderRadius: Number(e.target.value) } as Partial<Layer>)}
                  style={inputStyle}
                />
              </label>
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Opacity ({selected.opacity}%)</span>
              <input
                type="range" min={0} max={100} value={selected.opacity}
                onChange={e => updateLayer(selected.id, { opacity: Number(e.target.value) } as Partial<Layer>)}
                style={{ accentColor: ACCENT }}
              />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Stroke color</span>
                <input
                  type="color"
                  value={selected.strokeColor ?? '#000000'}
                  onChange={e => updateLayer(selected.id, { strokeColor: e.target.value } as Partial<Layer>)}
                  style={{ ...inputStyle, padding: 2, height: 30, cursor: 'pointer' }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Stroke width</span>
                <input
                  type="number" min={0} max={100}
                  value={selected.strokeWidth ?? 0}
                  onChange={e => updateLayer(selected.id, { strokeWidth: Number(e.target.value) } as Partial<Layer>)}
                  style={inputStyle}
                />
              </label>
            </div>
          </>
        )}

        {/* Appearance — ellipse */}
        {selected.kind === 'ellipse' && (
          <>
            {sectionLabel('Appearance')}
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Fill</span>
              <input
                type="color" value={selected.fill}
                onChange={e => updateLayer(selected.id, { fill: e.target.value } as Partial<Layer>)}
                style={{ ...inputStyle, padding: 2, height: 30, cursor: 'pointer' }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Opacity ({selected.opacity}%)</span>
              <input
                type="range" min={0} max={100} value={selected.opacity}
                onChange={e => updateLayer(selected.id, { opacity: Number(e.target.value) } as Partial<Layer>)}
                style={{ accentColor: ACCENT }}
              />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Stroke color</span>
                <input
                  type="color"
                  value={selected.strokeColor ?? '#000000'}
                  onChange={e => updateLayer(selected.id, { strokeColor: e.target.value } as Partial<Layer>)}
                  style={{ ...inputStyle, padding: 2, height: 30, cursor: 'pointer' }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Stroke width</span>
                <input
                  type="number" min={0} max={100}
                  value={selected.strokeWidth ?? 0}
                  onChange={e => updateLayer(selected.id, { strokeWidth: Number(e.target.value) } as Partial<Layer>)}
                  style={inputStyle}
                />
              </label>
            </div>
          </>
        )}

        {/* Typography — text */}
        {selected.kind === 'text' && (
          <>
            {sectionLabel('Typography')}
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Text</span>
              <input
                type="text" value={selected.text}
                onChange={e => updateLayer(selected.id, { text: e.target.value } as Partial<Layer>)}
                style={inputStyle}
              />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Size</span>
                <input
                  type="number" min={8} max={400} value={selected.fontSize}
                  onChange={e => updateLayer(selected.id, { fontSize: Number(e.target.value) } as Partial<Layer>)}
                  style={inputStyle}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Spacing</span>
                <input
                  type="number" min={-10} max={100}
                  value={selected.letterSpacing ?? 0}
                  onChange={e => updateLayer(selected.id, { letterSpacing: Number(e.target.value) } as Partial<Layer>)}
                  style={inputStyle}
                />
              </label>
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Color</span>
              <input
                type="color" value={selected.color}
                onChange={e => updateLayer(selected.id, { color: e.target.value } as Partial<Layer>)}
                style={{ ...inputStyle, padding: 2, height: 30, cursor: 'pointer' }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Opacity ({selected.opacity ?? 100}%)</span>
              <input
                type="range" min={0} max={100} value={selected.opacity ?? 100}
                onChange={e => updateLayer(selected.id, { opacity: Number(e.target.value) } as Partial<Layer>)}
                style={{ accentColor: ACCENT }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Weight</span>
              <select
                value={selected.fontWeight}
                onChange={e => updateLayer(selected.id, { fontWeight: e.target.value } as Partial<Layer>)}
                style={{ ...inputStyle, cursor: 'pointer' }}
              >
                <option value="400">Regular</option>
                <option value="600">Semibold</option>
                <option value="700">Bold</option>
                <option value="800">Extrabold</option>
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Font</span>
              <select
                value={selected.fontFamily ?? 'system-ui, sans-serif'}
                onChange={e => updateLayer(selected.id, { fontFamily: e.target.value } as Partial<Layer>)}
                style={{ ...inputStyle, cursor: 'pointer' }}
              >
                {FONT_FAMILIES.map(f => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Align</span>
              <div style={{ display: 'flex', gap: 4 }}>
                {(['left', 'center', 'right'] as const).map(a => (
                  <button
                    key={a}
                    onClick={() => updateLayer(selected.id, { textAlign: a } as Partial<Layer>)}
                    style={{
                      flex: 1, padding: '5px 0', borderRadius: 6, fontSize: 11,
                      border: `1px solid ${(selected.textAlign ?? 'left') === a ? ACCENT : 'var(--border)'}`,
                      background: (selected.textAlign ?? 'left') === a ? `color-mix(in srgb, ${ACCENT} 15%, transparent)` : 'transparent',
                      color: (selected.textAlign ?? 'left') === a ? ACCENT : 'var(--text-muted)',
                      cursor: 'pointer',
                    }}
                  >
                    {a === 'left' ? 'L' : a === 'center' ? 'C' : 'R'}
                  </button>
                ))}
              </div>
            </label>
          </>
        )}

        {/* Opacity — image */}
        {selected.kind === 'image' && (
          <>
            {sectionLabel('Appearance')}
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Opacity ({selected.opacity ?? 100}%)</span>
              <input
                type="range" min={0} max={100} value={selected.opacity ?? 100}
                onChange={e => updateLayer(selected.id, { opacity: Number(e.target.value) } as Partial<Layer>)}
                style={{ accentColor: ACCENT }}
              />
            </label>
          </>
        )}

        {/* Shadow — rect, ellipse, image */}
        {(selected.kind === 'rect' || selected.kind === 'ellipse' || selected.kind === 'image') && (
          <>
            {sectionLabel('Shadow')}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Color</span>
                <input
                  type="color"
                  value={selected.shadowColor ?? '#000000'}
                  onChange={e => updateLayer(selected.id, { shadowColor: e.target.value } as Partial<Layer>)}
                  style={{ ...inputStyle, padding: 2, height: 30, cursor: 'pointer' }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Blur</span>
                <input
                  type="number" min={0} max={100}
                  value={selected.shadowBlur ?? 0}
                  onChange={e => updateLayer(selected.id, { shadowBlur: Number(e.target.value) } as Partial<Layer>)}
                  style={inputStyle}
                />
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>X</span>
                <input
                  type="number" min={-100} max={100}
                  value={selected.shadowX ?? 0}
                  onChange={e => updateLayer(selected.id, { shadowX: Number(e.target.value) } as Partial<Layer>)}
                  style={inputStyle}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Y</span>
                <input
                  type="number" min={-100} max={100}
                  value={selected.shadowY ?? 0}
                  onChange={e => updateLayer(selected.id, { shadowY: Number(e.target.value) } as Partial<Layer>)}
                  style={inputStyle}
                />
              </label>
            </div>
          </>
        )}

        {/* Align to Canvas */}
        {sectionLabel('Align to Canvas')}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4 }}>
          {alignBtn(AlignStartHorizontal, 'Align left', () => updateLayer(selected.id, { x: 0 } as Partial<Layer>))}
          {alignBtn(AlignCenterHorizontal, 'Align center horizontal', () => updateLayer(selected.id, { x: Math.round((canvasW - layerW) / 2) } as Partial<Layer>))}
          {alignBtn(AlignEndHorizontal, 'Align right', () => updateLayer(selected.id, { x: Math.round(canvasW - layerW) } as Partial<Layer>))}
          {alignBtn(AlignStartVertical, 'Align top', () => updateLayer(selected.id, { y: 0 } as Partial<Layer>))}
          {alignBtn(AlignCenterVertical, 'Align center vertical', () => updateLayer(selected.id, { y: Math.round((canvasH - layerH) / 2) } as Partial<Layer>))}
          {alignBtn(AlignEndVertical, 'Align bottom', () => updateLayer(selected.id, { y: Math.round(canvasH - layerH) } as Partial<Layer>))}
        </div>

        {/* Actions */}
        {sectionLabel('Actions')}
        <button
          onClick={duplicateSelected}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '7px 0', borderRadius: 7,
            border: '1px solid var(--border)', background: 'transparent',
            color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = ACCENT; (e.currentTarget as HTMLButtonElement).style.color = ACCENT }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)' }}
        >
          <Copy size={12} /> Duplicate
        </button>
        <button
          onClick={deleteSelected}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '7px 0', borderRadius: 7,
            border: '1px solid var(--border)', background: 'transparent',
            color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#ef4444'; (e.currentTarget as HTMLButtonElement).style.color = '#ef4444' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)' }}
        >
          <Trash2 size={12} /> Delete layer
        </button>
      </div>
    )
  }

  // ── Tool button helper ─────────────────────────────────────

  function toolBtn(t: Tool, Icon: React.ComponentType<{ size?: number }>, title: string) {
    return (
      <button
        key={t}
        title={title}
        onClick={() => setTool(t)}
        style={{
          width: 36, height: 36, borderRadius: 8, border: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: tool === t ? `color-mix(in srgb, ${ACCENT} 18%, transparent)` : 'transparent',
          color: tool === t ? ACCENT : 'var(--text-muted)',
          cursor: 'pointer',
        }}
      >
        <Icon size={16} />
      </button>
    )
  }

  function iconBtn(title: string, Icon: React.ComponentType<{ size?: number }>, onClick: () => void, active = false) {
    return (
      <button
        title={title}
        onClick={onClick}
        style={{
          width: 36, height: 36, borderRadius: 8, border: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: active ? `color-mix(in srgb, ${ACCENT} 18%, transparent)` : 'transparent',
          color: active ? ACCENT : 'var(--text-muted)',
          cursor: 'pointer',
        }}
        onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.color = ACCENT }}
        onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)' }}
      >
        <Icon size={16} />
      </button>
    )
  }

  function closeAllDropdowns() {
    setShowPresets(false)
    setShowBgPicker(false)
    setShowExportMenu(false)
  }

  // ── Render ─────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-base)', overflow: 'hidden' }}
    >
      {/* ── Top toolbar ─────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '0 14px', height: 44, flexShrink: 0,
        borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)',
      }}>
        <Link
          href="/projects"
          style={{ display: 'flex', alignItems: 'center', color: 'var(--text-muted)', textDecoration: 'none', marginRight: 4 }}
        >
          <ArrowLeft size={15} />
        </Link>

        {/* Project name */}
        {editingName ? (
          <input
            ref={nameInputRef}
            autoFocus
            value={localName}
            onChange={e => setLocalName(e.target.value)}
            onBlur={() => {
              setEditingName(false)
              const trimmed = localName.trim()
              if (trimmed) onProjectNameCommit?.(trimmed)
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === 'Escape') {
                setEditingName(false)
                const trimmed = localName.trim()
                if (trimmed) onProjectNameCommit?.(trimmed)
              }
            }}
            style={{ fontSize: 13, fontWeight: 600, background: 'transparent', border: 'none', borderBottom: `1px solid ${ACCENT}`, outline: 'none', color: 'var(--text-primary)', width: 200 }}
          />
        ) : (
          <button
            onClick={() => setEditingName(true)}
            style={{ fontSize: 13, fontWeight: 600, background: 'transparent', border: 'none', color: 'var(--text-primary)', cursor: 'text', padding: 0 }}
          >
            {localName}
          </button>
        )}

        <div style={{ flex: 1 }} />

        {/* Background color */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => { setShowBgPicker(p => !p); setShowPresets(false); setShowExportMenu(false) }}
            title="Canvas background color"
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '5px 10px', borderRadius: 7,
              border: '1px solid var(--border)', background: 'var(--bg-card)',
              color: 'var(--text-secondary)', fontSize: 11, cursor: 'pointer',
            }}
          >
            <div style={{
              width: 14, height: 14, borderRadius: 3,
              background: bgColor,
              border: '1px solid rgba(128,128,128,0.3)',
              flexShrink: 0,
            }} />
            BG
          </button>
          {showBgPicker && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 50,
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
              borderRadius: 8, padding: 10,
              boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            }}>
              <input
                type="color" value={bgColor}
                onChange={e => setBgColor(e.target.value)}
                style={{ width: 120, height: 40, cursor: 'pointer', border: 'none', borderRadius: 4 }}
              />
            </div>
          )}
        </div>

        {/* Canvas presets */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => { setShowPresets(p => !p); setShowBgPicker(false); setShowExportMenu(false) }}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '5px 10px', borderRadius: 7,
              border: '1px solid var(--border)', background: 'var(--bg-card)',
              color: 'var(--text-secondary)', fontSize: 11, cursor: 'pointer',
            }}
          >
            {canvasW}×{canvasH} <ChevronDown size={11} />
          </button>
          {showPresets && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 40,
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
              borderRadius: 8, padding: '4px 0', minWidth: 220,
              boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            }}>
              {PRESETS.map(p => (
                <button
                  key={p.label}
                  onClick={() => { setCanvasW(p.width); setCanvasH(p.height); setShowPresets(false); setShowCustomSize(false) }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '7px 14px', fontSize: 12, background: 'transparent',
                    border: 'none', color: 'var(--text-primary)', cursor: 'pointer',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--border)')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}
                >
                  {p.label}
                </button>
              ))}
              <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
              <button
                onClick={() => { setCustomW(canvasW); setCustomH(canvasH); setShowCustomSize(c => !c) }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '7px 14px', fontSize: 12, background: 'transparent',
                  border: 'none', color: 'var(--text-primary)', cursor: 'pointer',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--border)')}
                onMouseLeave={e => (e.currentTarget.style.background = '')}
              >
                Custom…
              </button>
              {showCustomSize && (
                <div style={{ padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="number" min={1} max={8000} value={customW}
                      onChange={e => setCustomW(Number(e.target.value))}
                      style={{ ...inputStyle, width: 72 }}
                      placeholder="W"
                    />
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>×</span>
                    <input
                      type="number" min={1} max={8000} value={customH}
                      onChange={e => setCustomH(Number(e.target.value))}
                      style={{ ...inputStyle, width: 72 }}
                      placeholder="H"
                    />
                  </div>
                  <button
                    onClick={() => {
                      if (customW > 0 && customH > 0) {
                        setCanvasW(customW)
                        setCanvasH(customH)
                        setShowPresets(false)
                        setShowCustomSize(false)
                      }
                    }}
                    style={{
                      padding: '5px 10px', borderRadius: 6, fontSize: 12,
                      background: ACCENT, color: '#fff', border: 'none', cursor: 'pointer',
                    }}
                  >
                    Apply
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Export dropdown */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => { setShowExportMenu(m => !m); setShowPresets(false); setShowBgPicker(false) }}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '6px 12px', borderRadius: 7, border: 'none',
              background: ACCENT, color: '#fff', fontSize: 12, fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Download size={13} /> Export <ChevronDown size={11} />
          </button>
          {showExportMenu && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 50,
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
              borderRadius: 8, padding: '4px 0', minWidth: 100,
              boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            }}>
              {(['png', 'jpeg', 'webp'] as const).map(fmt => (
                <button
                  key={fmt}
                  onClick={() => { void exportAs(fmt); setShowExportMenu(false) }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '7px 14px', fontSize: 12, background: 'transparent',
                    border: 'none', color: 'var(--text-primary)', cursor: 'pointer',
                    textTransform: 'uppercase',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--border)')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}
                >
                  {fmt.toUpperCase()}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Main area ───────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ── Left panel: tools + layers ─────────────────── */}
        <div style={{
          width: 180, flexShrink: 0, display: 'flex', flexDirection: 'column',
          background: 'var(--bg-surface)', borderRight: '1px solid var(--border)',
        }}>
          {/* Tool buttons */}
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 2,
            padding: '8px', borderBottom: '1px solid var(--border)',
          }}>
            {toolBtn('select', MousePointer2, 'Select (V)')}
            {toolBtn('rect', Square, 'Rectangle (R)')}
            {toolBtn('ellipse', Circle, 'Ellipse (E)')}
            {toolBtn('text', Type, 'Text (T)')}
            {iconBtn('Upload image', ImageIcon, () => fileInputRef.current?.click())}
          </div>

          {/* Layers header */}
          <div style={{
            padding: '6px 10px 3px',
            fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
            textTransform: 'uppercase', color: 'var(--text-muted)',
          }}>
            Layers
          </div>

          {/* Layer list */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {layers.length === 0 && (
              <div style={{ padding: '12px 10px', color: 'var(--text-muted)', fontSize: 11, textAlign: 'center' }}>
                No layers
              </div>
            )}
            {[...layers].reverse().map(layer => {
              const isActive = layer.id === selectedId
              const isDragOver = dragOverLayerId === layer.id
              return (
                <div
                  key={layer.id}
                  draggable
                  onDragStart={e => {
                    dragLayerIdRef.current = layer.id
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragOver={e => {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    setDragOverLayerId(layer.id)
                  }}
                  onDragLeave={() => setDragOverLayerId(null)}
                  onDrop={e => {
                    e.preventDefault()
                    setDragOverLayerId(null)
                    if (!dragLayerIdRef.current || dragLayerIdRef.current === layer.id) return
                    saveHistory()
                    const fromId = dragLayerIdRef.current
                    setLayers(ls => {
                      const fromIdx = ls.findIndex(l => l.id === fromId)
                      const toIdx = ls.findIndex(l => l.id === layer.id)
                      if (fromIdx === -1 || toIdx === -1) return ls
                      const next = [...ls]
                      const [moved] = next.splice(fromIdx, 1)
                      next.splice(toIdx, 0, moved)
                      return next
                    })
                    dragLayerIdRef.current = null
                  }}
                  onDragEnd={() => setDragOverLayerId(null)}
                  onClick={() => setSelectedId(layer.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    padding: '5px 8px', cursor: 'pointer',
                    background: isActive ? `color-mix(in srgb, ${ACCENT} 12%, transparent)` : 'transparent',
                    borderLeft: isActive ? `2px solid ${ACCENT}` : '2px solid transparent',
                    borderTop: isDragOver ? `2px solid ${ACCENT}` : '2px solid transparent',
                  }}
                  onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = 'var(--border)' }}
                  onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
                >
                  <span
                    title="Drag to reorder"
                    style={{ color: 'var(--text-muted)', flexShrink: 0, display: 'flex', cursor: 'grab', opacity: 0.5 }}
                  >
                    <GripVertical size={10} />
                  </span>
                  <span style={{ color: 'var(--text-muted)', flexShrink: 0, display: 'flex' }}>
                    {layer.kind === 'rect'
                      ? <Square size={11} />
                      : layer.kind === 'ellipse'
                      ? <Circle size={11} />
                      : layer.kind === 'text'
                      ? <Type size={11} />
                      : <ImageIcon size={11} />}
                  </span>
                  {renamingLayerId === layer.id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={() => {
                        const trimmed = renameValue.trim()
                        if (trimmed) updateLayer(layer.id, { name: trimmed } as Partial<Layer>)
                        setRenamingLayerId(null)
                      }}
                      onKeyDown={e => {
                        e.stopPropagation()
                        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
                        if (e.key === 'Escape') setRenamingLayerId(null)
                      }}
                      style={{ fontSize: 11, background: 'transparent', border: 'none', borderBottom: '1px solid var(--accent)', outline: 'none', color: 'var(--text-primary)', width: '100%' }}
                    />
                  ) : (
                    <span
                      onDoubleClick={() => { setRenamingLayerId(layer.id); setRenameValue(layer.name) }}
                      style={{ fontSize: 11, color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {layer.name}
                    </span>
                  )}
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      updateLayer(layer.id, { hidden: !layer.hidden } as Partial<Layer>)
                    }}
                    style={{
                      background: 'transparent', border: 'none', padding: 0,
                      cursor: 'pointer', display: 'flex', flexShrink: 0,
                      color: layer.hidden ? 'var(--text-muted)' : 'var(--text-secondary)',
                      opacity: layer.hidden ? 0.5 : 0.8,
                    }}
                    title={layer.hidden ? 'Show layer' : 'Hide layer'}
                  >
                    {layer.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Canvas area ────────────────────────────────── */}
        <div
          ref={canvasAreaRef}
          style={{
            flex: 1, overflow: 'hidden', position: 'relative',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: '#1a1a1f',
            cursor: (tool === 'rect' || tool === 'ellipse') ? 'crosshair' : tool === 'text' ? 'text' : 'default',
          }}
          onClick={closeAllDropdowns}
        >
          {/* Scaled canvas wrapper */}
          <div
            style={{
              position: 'relative',
              width: canvasW,
              height: canvasH,
              transform: `scale(${scale * zoom})`,
              transformOrigin: 'center center',
              flexShrink: 0,
            }}
            onPointerDown={onCanvasPointerDown}
            onPointerMove={e => { onCanvasPointerMove(e); onLayerPointerMove(e); onResizePointerMove(e) }}
            onPointerUp={e => { onCanvasPointerUp(e); onLayerPointerUp(); onResizePointerUp() }}
          >
            {/* Canvas background */}
            <div style={{
              position: 'absolute', inset: 0,
              background: bgColor,
              boxShadow: '0 0 0 1px rgba(0,0,0,0.1), 0 4px 32px rgba(0,0,0,0.4)',
            }} />

            {/* Layers */}
            {layers.map(layer => {
              if (layer.hidden) return null
              const isSelected = layer.id === selectedId
              const selStyle: React.CSSProperties = isSelected ? {
                outline: `2px solid ${ACCENT}`,
                outlineOffset: 2,
              } : {}

              if (layer.kind === 'rect') {
                const sw = layer.strokeWidth ?? 0
                const rectShadow = (layer.shadowBlur || layer.shadowX || layer.shadowY)
                  ? `drop-shadow(${layer.shadowX ?? 0}px ${layer.shadowY ?? 0}px ${layer.shadowBlur ?? 0}px ${layer.shadowColor ?? '#000000'})`
                  : undefined
                return (
                  <div
                    key={layer.id}
                    onPointerDown={e => onLayerPointerDown(e, layer.id)}
                    style={{
                      position: 'absolute',
                      left: layer.x, top: layer.y,
                      width: layer.width, height: layer.height,
                      background: layer.fill,
                      opacity: layer.opacity / 100,
                      borderRadius: layer.borderRadius ?? 0,
                      border: sw > 0 ? `${sw}px solid ${layer.strokeColor ?? '#000000'}` : undefined,
                      boxSizing: 'border-box',
                      cursor: tool === 'select' ? 'move' : undefined,
                      userSelect: 'none',
                      filter: rectShadow,
                      ...selStyle,
                    }}
                  />
                )
              }

              if (layer.kind === 'ellipse') {
                const sw = layer.strokeWidth ?? 0
                const ellipseShadow = (layer.shadowBlur || layer.shadowX || layer.shadowY)
                  ? `drop-shadow(${layer.shadowX ?? 0}px ${layer.shadowY ?? 0}px ${layer.shadowBlur ?? 0}px ${layer.shadowColor ?? '#000000'})`
                  : undefined
                return (
                  <div
                    key={layer.id}
                    onPointerDown={e => onLayerPointerDown(e, layer.id)}
                    style={{
                      position: 'absolute',
                      left: layer.x, top: layer.y,
                      width: layer.width, height: layer.height,
                      background: layer.fill,
                      opacity: layer.opacity / 100,
                      borderRadius: '50%',
                      border: sw > 0 ? `${sw}px solid ${layer.strokeColor ?? '#000000'}` : undefined,
                      boxSizing: 'border-box',
                      cursor: tool === 'select' ? 'move' : undefined,
                      userSelect: 'none',
                      filter: ellipseShadow,
                      ...selStyle,
                    }}
                  />
                )
              }

              if (layer.kind === 'text') {
                const isEditing = editingTextId === layer.id
                const textStyle: React.CSSProperties = {
                  position: 'absolute',
                  left: layer.x, top: layer.y,
                  fontSize: layer.fontSize,
                  fontWeight: layer.fontWeight,
                  color: layer.color,
                  fontFamily: layer.fontFamily ?? 'system-ui, sans-serif',
                  textAlign: layer.textAlign ?? 'left',
                  letterSpacing: layer.letterSpacing ? `${layer.letterSpacing}px` : undefined,
                  whiteSpace: 'pre',
                  lineHeight: 1.2,
                  opacity: (layer.opacity ?? 100) / 100,
                }
                if (isEditing) {
                  return (
                    <div
                      key={layer.id}
                      contentEditable
                      suppressContentEditableWarning
                      data-edit-id={layer.id}
                      onPointerDown={e => e.stopPropagation()}
                      onBlur={e => {
                        updateLayer(layer.id, { text: e.currentTarget.textContent ?? '' } as Partial<Layer>)
                        setEditingTextId(null)
                      }}
                      onKeyDown={e => {
                        e.stopPropagation()
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          ;(e.currentTarget as HTMLDivElement).blur()
                        }
                        if (e.key === 'Escape') {
                          setEditingTextId(null)
                          ;(e.currentTarget as HTMLDivElement).blur()
                        }
                      }}
                      style={{
                        ...textStyle,
                        cursor: 'text',
                        userSelect: 'text',
                        minWidth: 20,
                        outline: `2px solid ${ACCENT}`,
                        outlineOffset: 2,
                      }}
                    >
                      {layer.text}
                    </div>
                  )
                }
                return (
                  <div
                    key={layer.id}
                    onPointerDown={e => onLayerPointerDown(e, layer.id)}
                    style={{
                      ...textStyle,
                      cursor: tool === 'select' ? 'move' : undefined,
                      userSelect: 'none',
                      ...selStyle,
                    }}
                  >
                    {layer.text}
                  </div>
                )
              }

              if (layer.kind === 'image') {
                const imgShadow = (layer.shadowBlur || layer.shadowX || layer.shadowY)
                  ? `drop-shadow(${layer.shadowX ?? 0}px ${layer.shadowY ?? 0}px ${layer.shadowBlur ?? 0}px ${layer.shadowColor ?? '#000000'})`
                  : undefined
                return (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={layer.id}
                    src={layer.src}
                    alt=""
                    draggable={false}
                    onPointerDown={e => onLayerPointerDown(e as unknown as React.PointerEvent<HTMLDivElement>, layer.id)}
                    style={{
                      position: 'absolute',
                      left: layer.x, top: layer.y,
                      width: layer.width, height: layer.height,
                      objectFit: 'fill',
                      opacity: (layer.opacity ?? 100) / 100,
                      cursor: tool === 'select' ? 'move' : undefined,
                      userSelect: 'none',
                      display: 'block',
                      filter: imgShadow,
                      ...(isSelected ? { outline: `2px solid ${ACCENT}`, outlineOffset: 2 } : {}),
                    }}
                  />
                )
              }

              return null
            })}

            {/* Resize handles — rendered outside layer stack, inside wrapper */}
            {selected && (() => {
              const { w: lw, h: lh } = getLayerDims(selected)
              const hs = 8
              const half = hs / 2
              type HandleDef = { id: string; left: number; top: number; cursor: string }
              const corners: HandleDef[] = [
                { id: 'tl', left: selected.x - half,          top: selected.y - half,          cursor: 'nw-resize' },
                { id: 'tr', left: selected.x + lw - half,     top: selected.y - half,          cursor: 'ne-resize' },
                { id: 'bl', left: selected.x - half,          top: selected.y + lh - half,     cursor: 'sw-resize' },
                { id: 'br', left: selected.x + lw - half,     top: selected.y + lh - half,     cursor: 'se-resize' },
              ]
              const edges: HandleDef[] = [
                { id: 'tc', left: selected.x + lw / 2 - half, top: selected.y - half,          cursor: 'n-resize' },
                { id: 'bc', left: selected.x + lw / 2 - half, top: selected.y + lh - half,     cursor: 's-resize' },
                { id: 'ml', left: selected.x - half,          top: selected.y + lh / 2 - half, cursor: 'w-resize' },
                { id: 'mr', left: selected.x + lw - half,     top: selected.y + lh / 2 - half, cursor: 'e-resize' },
              ]
              const handles = selected.kind === 'text' ? corners : [...corners, ...edges]
              return handles.map(hd => (
                <div
                  key={hd.id}
                  onPointerDown={e => onResizeHandlePointerDown(e, hd.id)}
                  style={{
                    position: 'absolute',
                    left: hd.left, top: hd.top,
                    width: hs, height: hs,
                    background: '#ffffff',
                    border: `1.5px solid ${ACCENT}`,
                    borderRadius: 1,
                    cursor: hd.cursor,
                    zIndex: 100,
                    boxSizing: 'border-box',
                    pointerEvents: 'all',
                  }}
                />
              ))
            })()}

            {/* Draw preview */}
            {drawPreview && (
              <div style={{
                position: 'absolute',
                left: drawPreview.x, top: drawPreview.y,
                width: drawPreview.w, height: drawPreview.h,
                border: `2px dashed ${ACCENT}`,
                background: `color-mix(in srgb, ${ACCENT} 15%, transparent)`,
                borderRadius: drawing?.tool === 'ellipse' ? '50%' : 0,
                pointerEvents: 'none',
              }} />
            )}
          </div>

          {/* Zoom controls */}
          <div style={{
            position: 'absolute', bottom: 12, right: 12,
            display: 'flex', alignItems: 'center', gap: 2,
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: 8, padding: '3px 6px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          }}>
            <button
              onClick={() => setZoom(z => Math.max(0.25, parseFloat((z - 0.25).toFixed(2))))}
              title="Zoom out"
              style={{ background: 'transparent', border: 'none', padding: '3px 4px', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', borderRadius: 4 }}
              onMouseEnter={e => (e.currentTarget.style.color = ACCENT)}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
            >
              <Minus size={12} />
            </button>
            <span style={{ fontSize: 11, minWidth: 38, textAlign: 'center', color: 'var(--text-secondary)', userSelect: 'none' }}>
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom(z => Math.min(4, parseFloat((z + 0.25).toFixed(2))))}
              title="Zoom in"
              style={{ background: 'transparent', border: 'none', padding: '3px 4px', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', borderRadius: 4 }}
              onMouseEnter={e => (e.currentTarget.style.color = ACCENT)}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
            >
              <Plus size={12} />
            </button>
            <button
              onClick={() => setZoom(1)}
              title="Reset zoom"
              style={{ background: 'transparent', border: 'none', padding: '3px 4px', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', borderRadius: 4 }}
              onMouseEnter={e => (e.currentTarget.style.color = ACCENT)}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
            >
              <Maximize2 size={12} />
            </button>
          </div>
        </div>

        {/* ── Right panel ────────────────────────────────── */}
        <div style={{
          width: 240, flexShrink: 0, overflowY: 'auto',
          background: 'var(--bg-surface)', borderLeft: '1px solid var(--border)',
        }}>
          <div style={{
            padding: '10px 12px 6px',
            fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: 'var(--text-muted)',
            borderBottom: '1px solid var(--border)',
          }}>
            Properties
          </div>
          <PropertiesPanel />
        </div>
      </div>

      {/* Hidden canvas for export */}
      <canvas ref={exportCanvasRef} style={{ display: 'none' }} />

      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} />
    </div>
  )
}
