// Keeps fixed-position menus/panels on screen: if the element would cross the
// bottom or right viewport edge, it opens upward/leftward from its anchor
// point instead. Call from a useLayoutEffect once the element has rendered.
export function clampToViewport(el: HTMLElement | null, anchor: { x: number; y: number }, margin = 8) {
  if (!el) return
  const r = el.getBoundingClientRect()
  let top = anchor.y
  let left = anchor.x
  if (anchor.y + r.height > window.innerHeight - margin) top = Math.max(margin, anchor.y - r.height)
  if (anchor.x + r.width > window.innerWidth - margin) left = Math.max(margin, anchor.x - r.width)
  el.style.top = `${top}px`
  el.style.left = `${left}px`
  el.style.right = 'auto'
}
