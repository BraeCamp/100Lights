// Keeps fixed-position menus/panels on screen. Anchored at a point, a menu
// normally opens down-and-right; if that would cross the bottom/right edge it
// opens upward/leftward instead, and whatever happens its bottom (and right)
// edge is pulled back onto the screen so it's never stranded off-view. A menu
// taller than the viewport is pinned near the top and made to scroll.
// Call from a useLayoutEffect once the element has rendered.
export function clampToViewport(el: HTMLElement | null, anchor: { x: number; y: number }, margin = 8) {
  if (!el) return
  const r = el.getBoundingClientRect()
  const vh = window.innerHeight
  const vw = window.innerWidth

  // ── Vertical ──
  let top = anchor.y
  // Too tall to fit anywhere → pin near the top and let it scroll.
  if (r.height > vh - 2 * margin) {
    top = margin
    el.style.maxHeight = `${vh - 2 * margin}px`
    el.style.overflowY = 'auto'
  } else {
    // If opening downward overflows the bottom, open upward from the anchor.
    if (anchor.y + r.height > vh - margin) top = anchor.y - r.height
    // Whichever direction, keep the whole box on screen (bottom edge, then top).
    if (top + r.height > vh - margin) top = vh - margin - r.height
    if (top < margin) top = margin
  }

  // ── Horizontal ──
  let left = anchor.x
  if (r.width <= vw - 2 * margin) {
    if (anchor.x + r.width > vw - margin) left = anchor.x - r.width
    if (left + r.width > vw - margin) left = vw - margin - r.width
    if (left < margin) left = margin
  } else {
    left = margin
  }

  el.style.top = `${top}px`
  el.style.left = `${left}px`
  el.style.right = 'auto'
  el.style.bottom = 'auto'
}
