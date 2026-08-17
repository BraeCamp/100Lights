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
