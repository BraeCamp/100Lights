// Text style engine for title clips — a font library + effect helpers shared by the preview
// (VideoPlayer) and export (compositor) so styled text looks identical in both. Fonts are
// system-available stacks (no webfont CDN — the Artifact/app CSP blocks those); each stack falls back
// gracefully. Effects (shadow / glow / outline / highlight box) are declared per title clip.

export interface FontDef { id: string; name: string; stack: string; category: 'sans' | 'serif' | 'mono' | 'display' | 'hand' }

export const FONT_LIBRARY: FontDef[] = [
  { id: 'system',      name: 'System',       stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',            category: 'sans' },
  { id: 'helvetica',   name: 'Helvetica',    stack: '"Helvetica Neue", Helvetica, Arial, sans-serif',                     category: 'sans' },
  { id: 'futura',      name: 'Futura',       stack: 'Futura, "Century Gothic", "Trebuchet MS", sans-serif',               category: 'sans' },
  { id: 'gill',        name: 'Gill Sans',    stack: '"Gill Sans", "Gill Sans MT", Calibri, sans-serif',                   category: 'sans' },
  { id: 'optima',      name: 'Optima',       stack: 'Optima, Segoe, "Segoe UI", Candara, sans-serif',                     category: 'sans' },
  { id: 'verdana',     name: 'Verdana',      stack: 'Verdana, Geneva, sans-serif',                                        category: 'sans' },
  { id: 'trebuchet',   name: 'Trebuchet',    stack: '"Trebuchet MS", Helvetica, sans-serif',                              category: 'sans' },
  { id: 'impact',      name: 'Impact',       stack: 'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif',          category: 'display' },
  { id: 'arial-black', name: 'Arial Black',  stack: '"Arial Black", "Arial Bold", Gadget, sans-serif',                    category: 'display' },
  { id: 'copperplate', name: 'Copperplate',  stack: 'Copperplate, "Copperplate Gothic Light", fantasy',                  category: 'display' },
  { id: 'rockwell',    name: 'Rockwell',     stack: 'Rockwell, "Rockwell Nova", "Courier Bold", Georgia, serif',          category: 'display' },
  { id: 'georgia',     name: 'Georgia',      stack: 'Georgia, "Times New Roman", serif',                                  category: 'serif' },
  { id: 'times',       name: 'Times',        stack: '"Times New Roman", Times, serif',                                    category: 'serif' },
  { id: 'baskerville', name: 'Baskerville',  stack: 'Baskerville, "Baskerville Old Face", Georgia, serif',                category: 'serif' },
  { id: 'palatino',    name: 'Palatino',     stack: '"Palatino Linotype", "Book Antiqua", Palatino, serif',               category: 'serif' },
  { id: 'didot',       name: 'Didot',        stack: 'Didot, "Didot LT STD", "Bodoni MT", "Times New Roman", serif',       category: 'serif' },
  { id: 'courier',     name: 'Courier',      stack: '"Courier New", Courier, monospace',                                  category: 'mono' },
  { id: 'mono',        name: 'Mono',         stack: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',                category: 'mono' },
  { id: 'comic',       name: 'Comic',        stack: '"Comic Sans MS", "Comic Sans", cursive',                            category: 'hand' },
  { id: 'brush',       name: 'Brush Script', stack: '"Brush Script MT", "Segoe Script", cursive',                         category: 'hand' },
  { id: 'marker',      name: 'Marker',       stack: '"Permanent Marker", "Comic Sans MS", cursive',                       category: 'hand' },
]

export const fontStack = (id?: string): string => FONT_LIBRARY.find(f => f.id === id)?.stack ?? FONT_LIBRARY[0].stack

// The style bag a title clip can carry (all optional; absent = the plain default).
export interface TextStyle {
  font?: string            // FONT_LIBRARY id
  weight?: number          // 400–900
  letterSpacing?: number   // em
  uppercase?: boolean
  shadow?: boolean         // soft drop shadow (legibility)
  glow?: string            // glow color (hex); absent = none
  outline?: number         // outline width px; 0/absent = none
  outlineColor?: string    // default black
}

// ── Title animation ─────────────────────────────────────────────────────────
// Punchy, professional in/out reveals for title clips — the kind you'd otherwise bake into the video.
// Shared by preview (CSS transform) and export (canvas transform) so they match exactly.
export type TitleAnimation = 'none' | 'fade' | 'slide-up' | 'rise' | 'pop' | 'drop' | 'zoom'
export const TITLE_ANIMATIONS: { value: TitleAnimation; label: string }[] = [
  { value: 'none',     label: 'None' },
  { value: 'fade',     label: 'Fade' },
  { value: 'rise',     label: 'Rise' },
  { value: 'slide-up', label: 'Slide up' },
  { value: 'pop',      label: 'Pop' },
  { value: 'drop',     label: 'Drop' },
  { value: 'zoom',     label: 'Zoom' },
]

const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3)
// easeOutBack — overshoots past 1 then settles, for a springy "pop".
const easeOutBack = (x: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2) }

/**
 * Animation state for a title at local progress `p` (0..1) over a clip of `durSec` seconds.
 * `dy` is a vertical offset as a FRACTION of the font size (positive = down); multiply by fontSize.
 * `scale` is a unitless multiplier around the text's own center. Both preview and export apply these.
 */
export function titleAnim(anim: TitleAnimation | undefined, p: number, durSec: number): { opacity: number; dy: number; scale: number } {
  const flat = { opacity: 1, dy: 0, scale: 1 }
  if (!anim || anim === 'none') return flat
  const dur = Math.max(0.001, durSec)
  const inDur = Math.min(0.4, dur * 0.45), outDur = Math.min(0.3, dur * 0.35)
  const tSec = p * dur
  const tIn = Math.max(0, Math.min(1, tSec / inDur))                 // 0→1 as it enters
  const tOut = Math.max(0, Math.min(1, (dur - tSec) / outDur))       // 1→0 as it leaves
  const fadeInOut = Math.min(1, tIn * 1.2) * Math.min(1, tOut * 1.4)
  switch (anim) {
    case 'fade':     return { opacity: fadeInOut, dy: 0, scale: 1 }
    case 'slide-up': return { opacity: Math.min(1, tIn * 1.5), dy: (1 - easeOutCubic(tIn)) * 0.5, scale: 1 }
    case 'rise':     return { opacity: fadeInOut, dy: (1 - easeOutCubic(tIn)) * 0.9, scale: 1 }
    case 'drop':     return { opacity: fadeInOut, dy: -(1 - easeOutCubic(tIn)) * 0.9, scale: 1 }
    case 'pop':      return { opacity: Math.min(1, tIn * 2) * Math.min(1, tOut * 1.6), dy: 0, scale: 0.6 + 0.4 * easeOutBack(tIn) }
    case 'zoom':     return { opacity: fadeInOut, dy: 0, scale: 0.2 + 0.8 * easeOutCubic(tIn) }
    default:         return flat
  }
}

// A CSS text-shadow chain that composes the requested effects (shadow + glow + outline).
export function textShadowCss(s: TextStyle | undefined, fontSize: number): string {
  const parts: string[] = []
  if (s?.shadow ?? true) parts.push(`0 ${Math.round(fontSize * 0.04)}px ${Math.round(fontSize * 0.08)}px rgba(0,0,0,0.55)`)
  if (s?.glow) { const g = s.glow; parts.push(`0 0 ${Math.round(fontSize * 0.25)}px ${g}`, `0 0 ${Math.round(fontSize * 0.5)}px ${g}`) }
  if (s?.outline && s.outline > 0) {
    const w = s.outline, c = s.outlineColor || '#000'
    for (let a = 0; a < 360; a += 45) parts.push(`${(Math.cos(a * Math.PI / 180) * w).toFixed(1)}px ${(Math.sin(a * Math.PI / 180) * w).toFixed(1)}px 0 ${c}`)
  }
  return parts.join(', ')
}
