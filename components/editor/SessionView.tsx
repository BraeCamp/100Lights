'use client'
import { useState, useRef, useEffect } from 'react'
import type { BeatType } from '@/lib/beat-analyzer'
import type { ReactNode } from 'react'

// ── Constants ──────────────────────────────────────────────────────────────────

export const SCENE_COUNT = 8

const CLIP_PALETTE = [
  '#7c3aed', '#dc2626', '#ca8a04', '#0284c7',
  '#059669', '#db2777', '#c2410c', '#0891b2',
]

const STYLE_ID = 'session-view-keyframes'

const LEFT_W  = 120
const SCENE_W = 110
const RIGHT_W = 64
const LANE_H  = 72
const HEADER_H = 40
const LAUNCH_H = 40

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SceneClip {
  id: string
  name: string
  color: string | null
  durationBars: number
}

export interface SessionLane {
  /** BeatType value or custom lane id */
  type: BeatType | string
  label: string
  color: string
  clips: (SceneClip | null)[]  // indexed by scene, length === SCENE_COUNT
  muted: boolean
}

export interface SessionViewProps {
  lanes: SessionLane[]
  onLaunchScene: (sceneIdx: number) => void
  onLaunchClip: (laneType: string, sceneIdx: number) => void
  onStopLane: (laneType: string) => void
  onStopAll: () => void
  onAddClip: (laneType: string, sceneIdx: number, clip: SceneClip) => void
  onRemoveClip: (laneType: string, sceneIdx: number) => void
  onEditClip: (laneType: string, sceneIdx: number) => void
  playing: Record<string, number | null>
  bpm?: number
}

interface ContextMenuState {
  laneType: string
  sceneIdx: number
  x: number
  y: number
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function randomId(): string {
  return Math.random().toString(36).slice(2, 10)
}

/** Convert a hex color string to rgba(...) with the given alpha. Falls back to the
 *  raw string if parsing fails (e.g. if a CSS variable is passed by mistake). */
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  let r: number, g: number, b: number
  if (h.length === 3) {
    r = parseInt(h[0] + h[0], 16)
    g = parseInt(h[1] + h[1], 16)
    b = parseInt(h[2] + h[2], 16)
  } else if (h.length === 6) {
    r = parseInt(h.slice(0, 2), 16)
    g = parseInt(h.slice(2, 4), 16)
    b = parseInt(h.slice(4, 6), 16)
  } else {
    return hex
  }
  if (isNaN(r) || isNaN(g) || isNaN(b)) return hex
  return `rgba(${r},${g},${b},${alpha})`
}

// ── Context menu item sub-component ───────────────────────────────────────────

function ContextMenuItem({
  children,
  onClick,
  danger = false,
}: {
  children: ReactNode
  onClick: () => void
  danger?: boolean
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      role="menuitem"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '6px 14px',
        cursor: 'pointer',
        color: danger ? '#f87171' : 'var(--text-primary)',
        backgroundColor: hovered
          ? danger
            ? 'rgba(239,68,68,0.12)'
            : 'rgba(255,255,255,0.07)'
          : 'transparent',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        transition: 'background-color 0.1s ease',
        fontSize: 12,
      }}
    >
      {children}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function SessionView({
  lanes,
  onLaunchScene,
  onLaunchClip,
  onStopLane,
  onStopAll,
  onAddClip,
  onRemoveClip,
  onEditClip,
  playing,
  bpm: _bpm = 120,
}: SessionViewProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  // Local color overrides keyed by `${laneType}-${sceneIdx}`
  const [clipColors, setClipColors] = useState<Record<string, string | null>>({})
  const menuRef = useRef<HTMLDivElement>(null)

  // Inject CSS keyframes once into <head>
  useEffect(() => {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
      @keyframes sv-pulse {
        0%   { box-shadow: 0 0 0 0   rgba(34,197,94,0.55); }
        50%  { box-shadow: 0 0 0 6px rgba(34,197,94,0);    }
        100% { box-shadow: 0 0 0 0   rgba(34,197,94,0.55); }
      }
      @keyframes sv-dot-pulse {
        0%,100% { opacity: 1;    transform: scale(1);    }
        50%      { opacity: 0.35; transform: scale(0.72); }
      }
    `
    document.head.appendChild(style)
    // Do not remove on unmount — other mounted instances may still need it
  }, [])

  // Close context menu on click-outside or Escape
  useEffect(() => {
    if (!contextMenu) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [contextMenu])

  // Resolve the effective display color for a clip (local override → clip.color → lane.color)
  function resolveClipColor(laneType: string, sceneIdx: number, clip: SceneClip, laneColor: string): string {
    const key = `${laneType}-${sceneIdx}`
    if (key in clipColors) return clipColors[key] ?? laneColor
    return clip.color ?? laneColor
  }

  function handleClipRightClick(
    e: { preventDefault(): void; stopPropagation(): void; clientX: number; clientY: number },
    laneType: string,
    sceneIdx: number,
  ) {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ laneType, sceneIdx, x: e.clientX, y: e.clientY })
  }

  function handleAddClip(laneType: string, sceneIdx: number) {
    onAddClip(laneType, sceneIdx, {
      id: randomId(),
      name: `Clip ${sceneIdx + 1}`,
      color: null,
      durationBars: 2,
    })
  }

  function handleColorPick(laneType: string, sceneIdx: number, color: string) {
    setClipColors(prev => ({ ...prev, [`${laneType}-${sceneIdx}`]: color }))
    setContextMenu(null)
  }

  // Context menu data
  const ctxLane = contextMenu ? (lanes.find(l => l.type === contextMenu.laneType) ?? null) : null
  const ctxClip = ctxLane && contextMenu != null ? (ctxLane.clips[contextMenu.sceneIdx] ?? null) : null

  return (
    <>
      {/* ────────────────────────── Main grid ────────────────────────────── */}
      <div
        style={{
          display: 'inline-block',
          fontFamily: "'JetBrains Mono','Fira Code','Cascadia Code',monospace",
          userSelect: 'none',
          backgroundColor: 'var(--bg-base)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        {/* ── Header row ─────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex',
          height: HEADER_H,
          alignItems: 'center',
          backgroundColor: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border)',
        }}>
          {/* "Session" label */}
          <div style={{ width: LEFT_W, minWidth: LEFT_W, paddingLeft: 14 }}>
            <span style={{
              fontSize: 9,
              fontWeight: 800,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
            }}>
              Session
            </span>
          </div>

          {/* Scene N column headers */}
          {Array.from({ length: SCENE_COUNT }, (_, i) => (
            <div key={i} style={{
              width: SCENE_W,
              minWidth: SCENE_W,
              textAlign: 'center',
              fontSize: 10,
              fontWeight: 500,
              color: 'var(--text-secondary)',
              letterSpacing: '0.04em',
            }}>
              Scene {i + 1}
            </div>
          ))}

          {/* Stop All button */}
          <div style={{
            width: RIGHT_W,
            minWidth: RIGHT_W,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <button
              onClick={onStopAll}
              style={{
                fontSize: 9,
                padding: '3px 7px',
                backgroundColor: 'rgba(220,38,38,0.12)',
                border: '1px solid rgba(220,38,38,0.35)',
                borderRadius: 4,
                color: '#f87171',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontWeight: 700,
                letterSpacing: '0.04em',
              }}
            >
              Stop All
            </button>
          </div>
        </div>

        {/* ── Lane rows ──────────────────────────────────────────────────── */}
        {lanes.map(lane => {
          const isLanePlaying = playing[lane.type] != null

          return (
            <div key={lane.type} style={{
              display: 'flex',
              height: LANE_H,
              alignItems: 'center',
              borderBottom: '1px solid var(--border)',
            }}>
              {/* Left cell: label + playing indicator */}
              <div style={{
                width: LEFT_W,
                minWidth: LEFT_W,
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                paddingLeft: 12,
                gap: 8,
                borderRight: '1px solid var(--border)',
              }}>
                {/* Lane color dot */}
                <div style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: lane.color,
                  flexShrink: 0,
                  opacity: lane.muted ? 0.3 : 1,
                }} />

                {/* Label */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: lane.muted ? 'var(--text-muted)' : 'var(--text-primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {lane.label}
                  </div>
                  {/* Playing indicator — always in DOM, color-toggled for layout stability */}
                  <div style={{
                    fontSize: 9,
                    color: isLanePlaying ? 'rgba(34,197,94,0.85)' : 'transparent',
                    marginTop: 1,
                    letterSpacing: '0.03em',
                    lineHeight: 1,
                  }}>
                    ▶ playing
                  </div>
                </div>
              </div>

              {/* Scene clip cells */}
              {Array.from({ length: SCENE_COUNT }, (_, sceneIdx) => {
                const clip = lane.clips[sceneIdx] ?? null
                const isPlaying = playing[lane.type] === sceneIdx
                const effectiveColor = clip
                  ? resolveClipColor(lane.type, sceneIdx, clip, lane.color)
                  : lane.color

                return (
                  <div key={sceneIdx} style={{
                    width: SCENE_W,
                    minWidth: SCENE_W,
                    height: LANE_H,
                    padding: 6,
                    display: 'flex',
                    alignItems: 'stretch',
                  }}>
                    {clip ? (
                      /* ── Filled clip card ──────────────────────────────── */
                      <div
                        role="button"
                        tabIndex={0}
                        aria-label={`${clip.name} — click to launch, right-click for options`}
                        onClick={() => onLaunchClip(lane.type, sceneIdx)}
                        onContextMenu={e => handleClipRightClick(e, lane.type, sceneIdx)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onLaunchClip(lane.type, sceneIdx) }}
                        style={{
                          flex: 1,
                          borderRadius: 6,
                          backgroundColor: hexToRgba(effectiveColor, 0.18),
                          border: isPlaying
                            ? `2px solid ${hexToRgba(effectiveColor, 0.95)}`
                            : `1px solid ${hexToRgba(effectiveColor, 0.45)}`,
                          cursor: 'pointer',
                          padding: '5px 7px',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          position: 'relative',
                          overflow: 'hidden',
                          animation: isPlaying ? 'sv-pulse 1.4s ease-in-out infinite' : 'none',
                          transition: 'border-color 0.15s ease, background-color 0.15s ease',
                          outline: 'none',
                        }}
                      >
                        {/* Pulsing green dot — only visible when playing */}
                        {isPlaying && (
                          <div style={{
                            position: 'absolute',
                            top: 5,
                            right: 5,
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            backgroundColor: 'rgba(34,197,94,1)',
                            animation: 'sv-dot-pulse 0.9s ease-in-out infinite',
                          }} />
                        )}

                        {/* Clip name */}
                        <div style={{
                          fontSize: 10,
                          fontWeight: 600,
                          color: 'var(--text-primary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          paddingRight: isPlaying ? 14 : 0,
                          lineHeight: 1.3,
                        }}>
                          {clip.name}
                        </div>

                        {/* Duration */}
                        <div style={{
                          fontSize: 9,
                          color: 'var(--text-muted)',
                          lineHeight: 1,
                          marginTop: 2,
                        }}>
                          {clip.durationBars} bar{clip.durationBars !== 1 ? 's' : ''}
                        </div>
                      </div>
                    ) : (
                      /* ── Empty cell ────────────────────────────────────── */
                      <EmptyCell onClick={() => handleAddClip(lane.type, sceneIdx)} />
                    )}
                  </div>
                )
              })}

              {/* Right cell: stop-lane button */}
              <div style={{
                width: RIGHT_W,
                minWidth: RIGHT_W,
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderLeft: '1px solid var(--border)',
              }}>
                <StopLaneButton
                  onClick={() => onStopLane(lane.type)}
                  title={`Stop ${lane.label}`}
                  active={isLanePlaying}
                />
              </div>
            </div>
          )
        })}

        {/* ── Scene launch row ───────────────────────────────────────────── */}
        <div style={{
          display: 'flex',
          height: LAUNCH_H,
          alignItems: 'center',
          backgroundColor: 'var(--bg-surface)',
          borderTop: '1px solid var(--border)',
        }}>
          {/* "Launch" label */}
          <div style={{
            width: LEFT_W,
            minWidth: LEFT_W,
            paddingLeft: 14,
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
          }}>
            Launch
          </div>

          {/* ▶ N buttons */}
          {Array.from({ length: SCENE_COUNT }, (_, i) => (
            <div key={i} style={{
              width: SCENE_W,
              minWidth: SCENE_W,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <LaunchSceneButton index={i} onClick={() => onLaunchScene(i)} />
            </div>
          ))}

          {/* Right spacer */}
          <div style={{ width: RIGHT_W, minWidth: RIGHT_W }} />
        </div>
      </div>

      {/* ── Context menu (portal-less fixed overlay) ──────────────────────── */}
      {contextMenu && ctxClip && ctxLane && (
        <div
          ref={menuRef}
          role="menu"
          style={{
            position: 'fixed',
            zIndex: 9999,
            top: contextMenu.y,
            left: contextMenu.x,
            backgroundColor: 'var(--bg-card, #16161e)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            boxShadow: '0 10px 36px rgba(0,0,0,0.6)',
            minWidth: 172,
            padding: '4px 0',
            fontFamily: "'JetBrains Mono','Fira Code',monospace",
          }}
        >
          <ContextMenuItem
            onClick={() => {
              onLaunchClip(contextMenu.laneType, contextMenu.sceneIdx)
              setContextMenu(null)
            }}
          >
            ▶&nbsp; Launch
          </ContextMenuItem>

          <ContextMenuItem
            onClick={() => {
              onEditClip(contextMenu.laneType, contextMenu.sceneIdx)
              setContextMenu(null)
            }}
          >
            ⎆&nbsp; Edit in Arrangement
          </ContextMenuItem>

          <div style={{ height: 1, backgroundColor: 'var(--border)', margin: '3px 0' }} />

          <ContextMenuItem
            danger
            onClick={() => {
              onRemoveClip(contextMenu.laneType, contextMenu.sceneIdx)
              setContextMenu(null)
            }}
          >
            ✕&nbsp; Remove
          </ContextMenuItem>

          <div style={{ height: 1, backgroundColor: 'var(--border)', margin: '3px 0' }} />

          {/* Color picker */}
          <div style={{
            padding: '4px 14px 3px',
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.09em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
          }}>
            Color
          </div>
          <div style={{ padding: '4px 14px 8px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {CLIP_PALETTE.map(color => (
              <ColorDot
                key={color}
                color={color}
                onClick={() => handleColorPick(contextMenu.laneType, contextMenu.sceneIdx, color)}
              />
            ))}
          </div>
        </div>
      )}
    </>
  )
}

// ── Small presentational sub-components ───────────────────────────────────────

function EmptyCell({ onClick }: { onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Add clip"
      onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onClick() }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title="Click to add clip"
      style={{
        flex: 1,
        border: `1px dashed ${hovered ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.1)'}`,
        borderRadius: 6,
        backgroundColor: hovered ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.018)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'border-color 0.12s ease, background-color 0.12s ease',
        outline: 'none',
      }}
    >
      <span style={{
        fontSize: 18,
        color: hovered ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.12)',
        lineHeight: 1,
        fontWeight: 300,
        transition: 'color 0.12s ease',
      }}>
        +
      </span>
    </div>
  )
}

function StopLaneButton({
  onClick,
  title,
  active,
}: {
  onClick: () => void
  title: string
  active: boolean
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 28,
        height: 28,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: active || hovered
          ? 'rgba(220,38,38,0.2)'
          : 'rgba(220,38,38,0.06)',
        border: `1px solid rgba(220,38,38,${active ? '0.5' : '0.2'})`,
        borderRadius: 4,
        color: '#f87171',
        cursor: 'pointer',
        fontSize: 11,
        lineHeight: 1,
        fontFamily: 'inherit',
        transition: 'background-color 0.12s ease, border-color 0.12s ease',
      }}
    >
      ■
    </button>
  )
}

function LaunchSceneButton({ index, onClick }: { index: number; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        fontSize: 10,
        padding: '4px 10px',
        backgroundColor: hovered ? 'rgba(34,197,94,0.2)' : 'rgba(34,197,94,0.1)',
        border: `1px solid rgba(34,197,94,${hovered ? '0.5' : '0.28'})`,
        borderRadius: 4,
        color: 'rgba(34,197,94,0.9)',
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontWeight: 600,
        letterSpacing: '0.02em',
        transition: 'background-color 0.12s ease, border-color 0.12s ease',
      }}
    >
      ▶ {index + 1}
    </button>
  )
}

function ColorDot({ color, onClick }: { color: string; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Set color to ${color}`}
      onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onClick() }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={color}
      style={{
        width: 16,
        height: 16,
        borderRadius: '50%',
        backgroundColor: color,
        cursor: 'pointer',
        outline: `1px solid rgba(255,255,255,${hovered ? '0.45' : '0.2'})`,
        outlineOffset: 1,
        transform: hovered ? 'scale(1.25)' : 'scale(1)',
        transition: 'transform 0.1s ease, outline-color 0.1s ease',
      }}
    />
  )
}
