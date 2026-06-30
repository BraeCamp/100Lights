'use client'

import { useState, useRef, useCallback, useEffect, useId } from 'react'
import {
  MousePointer2, Square, Type, ImageIcon, Download, ChevronDown,
  Trash2, ArrowLeft,
} from 'lucide-react'
import Link from 'next/link'

// ── Types ──────────────────────────────────────────────────────

type RectLayer = {
  id: string
  kind: 'rect'
  x: number
  y: number
  width: number
  height: number
  fill: string
  opacity: number
}

type TextLayer = {
  id: string
  kind: 'text'
  x: number
  y: number
  text: string
  fontSize: number
  color: string
  fontWeight: string
}

type ImageLayer = {
  id: string
  kind: 'image'
  x: number
  y: number
  width: number
  height: number
  src: string
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

// ── Helpers ────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

// ── Props ──────────────────────────────────────────────────────

export interface ImageEditorProps {
  projectId?: string
  projectName: string
  onProjectNameCommit?: (name: string) => void
}

// ── Component ──────────────────────────────────────────────────

export default function ImageEditor({ projectName, onProjectNameCommit }: ImageEditorProps) {
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

  const containerRef = useRef<HTMLDivElement>(null)
  const canvasAreaRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const exportCanvasRef = useRef<HTMLCanvasElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  const selected = layers.find(l => l.id === selectedId) ?? null

  // ── Scale to fit canvas in viewport ───────────────────────
  const [scale, setScale] = useState(1)

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

  // ── Layer mutations ────────────────────────────────────────

  function updateLayer(id: string, patch: Partial<Layer>) {
    setLayers(ls => ls.map(l => l.id === id ? { ...l, ...patch } as Layer : l))
  }

  function deleteSelected() {
    if (!selectedId) return
    setLayers(ls => ls.filter(l => l.id !== selectedId))
    setSelectedId(null)
  }

  // ── Tool: pointer events on the canvas ────────────────────

  function canvasCoords(e: React.PointerEvent): { x: number; y: number } {
    const el = e.currentTarget as HTMLDivElement
    const rect = el.getBoundingClientRect()
    return {
      x: Math.round((e.clientX - rect.left) / scale),
      y: Math.round((e.clientY - rect.top) / scale),
    }
  }

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
      const layer: TextLayer = { id, kind: 'text', x, y, text: 'Text', fontSize: 32, color: '#ffffff', fontWeight: '600' }
      setLayers(ls => [...ls, layer])
      setSelectedId(id)
      setTool('select')
      return
    }
    // select tool — click on empty space deselects
    setSelectedId(null)
  }

  const [drawPreview, setDrawPreview] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

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
      const layer: RectLayer = {
        id, kind: 'rect',
        x: drawPreview.x, y: drawPreview.y,
        width: drawPreview.w, height: drawPreview.h,
        fill: '#ec4899', opacity: 100,
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
    setDragging({ id, startX: e.clientX, startY: e.clientY, origX: layer.x, origY: layer.y })
  }

  function onLayerPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return
    const dx = Math.round((e.clientX - dragging.startX) / scale)
    const dy = Math.round((e.clientY - dragging.startY) / scale)
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
        const layer: ImageLayer = { id, kind: 'image', x: Math.round((canvasW - w) / 2), y: Math.round((canvasH - h) / 2), width: w, height: h, src }
        setLayers(ls => [...ls, layer])
        setSelectedId(id)
      }
      img.src = src
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  // ── Export to PNG via canvas ───────────────────────────────

  function exportPNG() {
    const canvas = exportCanvasRef.current
    if (!canvas) return
    canvas.width = canvasW
    canvas.height = canvasH
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // White background
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvasW, canvasH)

    for (const layer of layers) {
      ctx.save()
      if (layer.kind === 'rect') {
        ctx.globalAlpha = (layer.opacity ?? 100) / 100
        ctx.fillStyle = layer.fill
        ctx.fillRect(layer.x, layer.y, layer.width, layer.height)
      } else if (layer.kind === 'text') {
        ctx.globalAlpha = 1
        ctx.fillStyle = layer.color
        ctx.font = `${layer.fontWeight} ${layer.fontSize}px system-ui, sans-serif`
        ctx.fillText(layer.text, layer.x, layer.y + layer.fontSize)
      } else if (layer.kind === 'image') {
        const img = new window.Image()
        img.src = layer.src
        // Draw synchronously — img.src is already a data URL so it's loaded
        ctx.drawImage(img, layer.x, layer.y, layer.width, layer.height)
      }
      ctx.restore()
    }

    canvas.toBlob(blob => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${localName.replace(/\s+/g, '-').toLowerCase()}.png`
      a.click()
      URL.revokeObjectURL(url)
    }, 'image/png')
  }

  // ── Keyboard shortcuts ─────────────────────────────────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return
      if (e.key === 'Backspace' || e.key === 'Delete') deleteSelected()
      if (e.key === 'v' || e.key === 'Escape') setTool('select')
      if (e.key === 'r') setTool('rect')
      if (e.key === 't') setTool('text')
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

    return (
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          {selected.kind === 'rect' ? 'Rectangle' : selected.kind === 'text' ? 'Text' : 'Image'}
        </div>

        {/* Position */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>X</span>
            <input
              type="number"
              value={selected.x}
              onChange={e => updateLayer(selected.id, { x: Number(e.target.value) } as Partial<Layer>)}
              style={inputStyle}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Y</span>
            <input
              type="number"
              value={selected.y}
              onChange={e => updateLayer(selected.id, { y: Number(e.target.value) } as Partial<Layer>)}
              style={inputStyle}
            />
          </label>
        </div>

        {/* Size (rect + image) */}
        {(selected.kind === 'rect' || selected.kind === 'image') && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>W</span>
              <input
                type="number"
                value={selected.width}
                onChange={e => updateLayer(selected.id, { width: Number(e.target.value) } as Partial<Layer>)}
                style={inputStyle}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>H</span>
              <input
                type="number"
                value={selected.height}
                onChange={e => updateLayer(selected.id, { height: Number(e.target.value) } as Partial<Layer>)}
                style={inputStyle}
              />
            </label>
          </div>
        )}

        {/* Rect: fill + opacity */}
        {selected.kind === 'rect' && (
          <>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Fill</span>
              <input
                type="color"
                value={selected.fill}
                onChange={e => updateLayer(selected.id, { fill: e.target.value } as Partial<Layer>)}
                style={{ ...inputStyle, padding: 2, height: 32, cursor: 'pointer' }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Opacity ({selected.opacity}%)</span>
              <input
                type="range"
                min={0} max={100}
                value={selected.opacity}
                onChange={e => updateLayer(selected.id, { opacity: Number(e.target.value) } as Partial<Layer>)}
                style={{ accentColor: '#ec4899' }}
              />
            </label>
          </>
        )}

        {/* Text: text content, font size, color, weight */}
        {selected.kind === 'text' && (
          <>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Text</span>
              <input
                type="text"
                value={selected.text}
                onChange={e => updateLayer(selected.id, { text: e.target.value } as Partial<Layer>)}
                style={inputStyle}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Font size</span>
              <input
                type="number"
                min={8} max={400}
                value={selected.fontSize}
                onChange={e => updateLayer(selected.id, { fontSize: Number(e.target.value) } as Partial<Layer>)}
                style={inputStyle}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Color</span>
              <input
                type="color"
                value={selected.color}
                onChange={e => updateLayer(selected.id, { color: e.target.value } as Partial<Layer>)}
                style={{ ...inputStyle, padding: 2, height: 32, cursor: 'pointer' }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
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
          </>
        )}

        {/* Delete */}
        <button
          onClick={deleteSelected}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '7px 0', borderRadius: 7,
            border: '1px solid var(--border)', background: 'transparent',
            color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer',
            marginTop: 4,
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#ef4444'; (e.currentTarget as HTMLButtonElement).style.color = '#ef4444' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)' }}
        >
          <Trash2 size={12} /> Delete layer
        </button>
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────

  const ACCENT = '#ec4899'

  const toolBtn = (t: Tool, Icon: React.ComponentType<{ size?: number; color?: string }>, title: string) => (
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

  return (
    <div
      ref={containerRef}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-base)', overflow: 'hidden' }}
    >
      {/* ── Top toolbar ─────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
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

        {/* Canvas presets */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowPresets(p => !p)}
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
            <div
              style={{
                position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 40,
                background: 'var(--bg-surface)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '4px 0', minWidth: 220,
                boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
              }}
            >
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

        {/* Export */}
        <button
          onClick={exportPNG}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 7, border: 'none',
            background: ACCENT, color: '#fff', fontSize: 12, fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <Download size={13} /> Export PNG
        </button>
      </div>

      {/* ── Main area ───────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Left toolbar */}
        <div style={{
          width: 48, flexShrink: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', gap: 4, padding: '12px 6px',
          background: 'var(--bg-surface)', borderRight: '1px solid var(--border)',
        }}>
          {toolBtn('select', MousePointer2, 'Select (V)')}
          {toolBtn('rect', Square, 'Rectangle (R)')}
          {toolBtn('text', Type, 'Text (T)')}
          <button
            title="Upload image"
            onClick={() => fileInputRef.current?.click()}
            style={{
              width: 36, height: 36, borderRadius: 8, border: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = ACCENT)}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
          >
            <ImageIcon size={16} />
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} />
        </div>

        {/* Canvas area */}
        <div
          ref={canvasAreaRef}
          style={{
            flex: 1, overflow: 'hidden', display: 'flex', alignItems: 'center',
            justifyContent: 'center', background: '#1a1a1f',
            cursor: tool === 'rect' ? 'crosshair' : tool === 'text' ? 'text' : 'default',
          }}
          onClick={() => setShowPresets(false)}
        >
          {/* Scaled canvas wrapper */}
          <div
            style={{
              position: 'relative',
              width: canvasW,
              height: canvasH,
              transform: `scale(${scale})`,
              transformOrigin: 'center center',
              flexShrink: 0,
            }}
            onPointerDown={onCanvasPointerDown}
            onPointerMove={e => { onCanvasPointerMove(e); onLayerPointerMove(e) }}
            onPointerUp={e => { onCanvasPointerUp(e); onLayerPointerUp() }}
          >
            {/* White canvas background */}
            <div style={{ position: 'absolute', inset: 0, background: '#ffffff', boxShadow: '0 0 0 1px rgba(0,0,0,0.1), 0 4px 32px rgba(0,0,0,0.4)' }} />

            {/* Layers */}
            {layers.map(layer => {
              const isSelected = layer.id === selectedId
              const selStyle: React.CSSProperties = isSelected ? {
                outline: `2px solid ${ACCENT}`,
                outlineOffset: 2,
              } : {}

              if (layer.kind === 'rect') {
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
                      fontFamily: 'system-ui, sans-serif',
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
        </div>

        {/* Right panel */}
        <div style={{
          width: 200, flexShrink: 0, overflowY: 'auto',
          background: 'var(--bg-surface)', borderLeft: '1px solid var(--border)',
        }}>
          <div style={{ padding: '10px 14px 6px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
            Properties
          </div>
          <PropertiesPanel />
        </div>
      </div>

      {/* Hidden canvas for export */}
      <canvas ref={exportCanvasRef} style={{ display: 'none' }} />
    </div>
  )
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
}
