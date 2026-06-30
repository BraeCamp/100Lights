'use client'

import { useState, useRef, useEffect } from 'react'
import {
  MousePointer2, Square, Type, ImageIcon, Download, ChevronDown,
  Trash2, ArrowLeft, Eye, EyeOff, Copy,
  AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  Minus, Plus, Maximize2,
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
  hidden?: boolean
}

type Layer = RectLayer | TextLayer | ImageLayer

type Tool = 'select' | 'rect' | 'text'

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
  if (layer.kind === 'rect' || layer.kind === 'image') {
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
  const [dragging, setDragging] = useState<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null)
  const [drawing, setDrawing] = useState<{ startX: number; startY: number } | null>(null)
  const [drawPreview, setDrawPreview] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [bgColor, setBgColor] = useState('#ffffff')
  const [showBgPicker, setShowBgPicker] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [scale, setScale] = useState(1)

  const containerRef = useRef<HTMLDivElement>(null)
  const canvasAreaRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const exportCanvasRef = useRef<HTMLCanvasElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  const undoHistory = useRef<Layer[][]>([])
  const redoHistory = useRef<Layer[][]>([])

  const rectCountRef = useRef(0)
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
    if (tool === 'rect') {
      const { x, y } = canvasCoords(e)
      setDrawing({ startX: x, startY: y })
      ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
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
        text: 'Text', fontSize: 32, color: '#ffffff', fontWeight: '600',
        fontFamily: 'system-ui, sans-serif', textAlign: 'left', letterSpacing: 0,
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
      const name = `Rectangle ${++rectCountRef.current}`
      saveHistory()
      const layer: RectLayer = {
        id, kind: 'rect', name,
        x: drawPreview.x, y: drawPreview.y,
        width: drawPreview.w, height: drawPreview.h,
        fill: '#ec4899', opacity: 100,
        borderRadius: 0, strokeColor: '#000000', strokeWidth: 0,
      }
      setLayers(ls => [...ls, layer])
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
          width: w, height: h, src,
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

  function exportAs(format: 'png' | 'jpeg' | 'webp') {
    const canvas = exportCanvasRef.current
    if (!canvas) return
    canvas.width = canvasW
    canvas.height = canvasH
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.fillStyle = bgColor
    ctx.fillRect(0, 0, canvasW, canvasH)

    for (const layer of layers) {
      if (layer.hidden) continue
      ctx.save()
      if (layer.kind === 'rect') {
        ctx.globalAlpha = (layer.opacity ?? 100) / 100
        const r = layer.borderRadius ?? 0
        ctx.fillStyle = layer.fill
        if (r > 0) {
          ctx.beginPath()
          ctx.roundRect(layer.x, layer.y, layer.width, layer.height, r)
          ctx.fill()
        } else {
          ctx.fillRect(layer.x, layer.y, layer.width, layer.height)
        }
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
      } else if (layer.kind === 'text') {
        ctx.globalAlpha = 1
        ctx.fillStyle = layer.color
        const ff = layer.fontFamily ?? 'system-ui, sans-serif'
        ctx.font = `${layer.fontWeight} ${layer.fontSize}px ${ff}`
        ctx.textAlign = layer.textAlign ?? 'left'
        ctx.fillText(layer.text, layer.x, layer.y + layer.fontSize)
      } else if (layer.kind === 'image') {
        const img = new window.Image()
        img.src = layer.src
        ctx.drawImage(img, layer.x, layer.y, layer.width, layer.height)
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
      if (e.key === 'Backspace' || e.key === 'Delete') deleteSelected()
      if (e.key === 'v' || e.key === 'Escape') setTool('select')
      if (e.key === 'r') setTool('rect')
      if (e.key === 't') setTool('text')
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault()
        undo()
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'z') {
        e.preventDefault()
        redo()
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
          {selected.kind === 'rect' ? 'Rectangle' : selected.kind === 'text' ? 'Text' : 'Image'}
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
        {(selected.kind === 'rect' || selected.kind === 'image') && (
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
                  onClick={() => { setCanvasW(p.width); setCanvasH(p.height); setShowPresets(false) }}
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
                  onClick={() => { exportAs(fmt); setShowExportMenu(false) }}
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
              return (
                <div
                  key={layer.id}
                  onClick={() => setSelectedId(layer.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '5px 8px', cursor: 'pointer',
                    background: isActive ? `color-mix(in srgb, ${ACCENT} 12%, transparent)` : 'transparent',
                    borderLeft: isActive ? `2px solid ${ACCENT}` : '2px solid transparent',
                  }}
                  onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = 'var(--border)' }}
                  onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
                >
                  <span style={{ color: 'var(--text-muted)', flexShrink: 0, display: 'flex' }}>
                    {layer.kind === 'rect'
                      ? <Square size={11} />
                      : layer.kind === 'text'
                      ? <Type size={11} />
                      : <ImageIcon size={11} />}
                  </span>
                  <span style={{
                    fontSize: 11,
                    color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                    flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {layer.name}
                  </span>
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
            cursor: tool === 'rect' ? 'crosshair' : tool === 'text' ? 'text' : 'default',
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
            onPointerMove={e => { onCanvasPointerMove(e); onLayerPointerMove(e) }}
            onPointerUp={e => { onCanvasPointerUp(e); onLayerPointerUp() }}
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
                      ...selStyle,
                    }}
                  />
                )
              }

              if (layer.kind === 'text') {
                return (
                  <div
                    key={layer.id}
                    onPointerDown={e => onLayerPointerDown(e, layer.id)}
                    style={{
                      position: 'absolute',
                      left: layer.x, top: layer.y,
                      fontSize: layer.fontSize,
                      fontWeight: layer.fontWeight,
                      color: layer.color,
                      fontFamily: layer.fontFamily ?? 'system-ui, sans-serif',
                      textAlign: layer.textAlign ?? 'left',
                      letterSpacing: layer.letterSpacing ? `${layer.letterSpacing}px` : undefined,
                      whiteSpace: 'pre',
                      cursor: tool === 'select' ? 'move' : undefined,
                      userSelect: 'none',
                      lineHeight: 1.2,
                      ...selStyle,
                    }}
                  >
                    {layer.text}
                  </div>
                )
              }

              if (layer.kind === 'image') {
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
                      cursor: tool === 'select' ? 'move' : undefined,
                      userSelect: 'none',
                      display: 'block',
                      ...(isSelected ? { outline: `2px solid ${ACCENT}`, outlineOffset: 2 } : {}),
                    }}
                  />
                )
              }

              return null
            })}

            {/* Draw preview rect */}
            {drawPreview && (
              <div style={{
                position: 'absolute',
                left: drawPreview.x, top: drawPreview.y,
                width: drawPreview.w, height: drawPreview.h,
                border: `2px dashed ${ACCENT}`,
                background: `color-mix(in srgb, ${ACCENT} 15%, transparent)`,
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
