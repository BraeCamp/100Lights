'use client'
// Stop the browser text-selecting while something is being dragged.
//
// Brae: "when I drag anything it also does the drag to select feature when it
// grabbed items shouldn't activate drag to select."
//
// ⚠️ IT IS THE BROWSER'S SELECTION, NOT THE STUDIO'S. Every marquee this app
// draws is deliberate and gated — the piano roll's needs shift and an empty
// grid, and it calls preventDefault precisely so the native box does not appear
// under it. What is left is the default behaviour of a mouse drag on a page:
// once the pointer leaves the element it grabbed, the browser starts selecting
// whatever it passes over, and highlights lanes, labels and numbers behind the
// thing being moved.
//
// A clip already sets user-select:none on ITSELF, which is why grabbing one
// looks correct right up until the pointer moves off it. The guard has to cover
// the page, not the handle.
//
// ⚠️ FOR THE DURATION OF THE DRAG ONLY. The studio has real text in it — track
// names, fields, the console — and selecting that is something people do on
// purpose. A permanent user-select:none would be a second, quieter bug.

let installed = false
let depth = 0

const CLASS = 'daw-dragging'

function isTextEntry(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  return !!el?.closest?.('input, textarea, [contenteditable="true"]')
}

function end(): void {
  depth = 0
  document.documentElement.classList.remove(CLASS)
}

/**
 * Install once, for the life of the page.
 *
 * Capture phase, so it runs before any handler that might stop propagation —
 * a drag whose own code swallows the event still needs the guard.
 */
export function installDragSelectionGuard(): () => void {
  if (installed || typeof document === 'undefined') return () => {}
  installed = true

  const down = (e: PointerEvent) => {
    // A drag that starts inside a text field IS a text selection. Leave it.
    if (isTextEntry(e.target)) return
    // Only primary-button drags: a right-click opens a menu, and a middle-click
    // scrolls, and neither should suppress anything.
    if (e.button !== 0) return
    depth++
    document.documentElement.classList.add(CLASS)
  }

  // ⚠️ EVERY WAY A DRAG CAN END, not just pointerup. A pointer lost to a
  // cancelled gesture, a window blur, or a drop handled elsewhere would
  // otherwise leave the page unable to select text until the next click —
  // exactly the quieter bug this is trying not to introduce.
  const up = () => { depth = Math.max(0, depth - 1); if (depth === 0) end() }

  document.addEventListener('pointerdown', down, true)
  document.addEventListener('pointerup', up, true)
  document.addEventListener('pointercancel', end, true)
  document.addEventListener('dragend', end, true)
  document.addEventListener('drop', end, true)
  window.addEventListener('blur', end)

  return () => {
    document.removeEventListener('pointerdown', down, true)
    document.removeEventListener('pointerup', up, true)
    document.removeEventListener('pointercancel', end, true)
    document.removeEventListener('dragend', end, true)
    document.removeEventListener('drop', end, true)
    window.removeEventListener('blur', end)
    end()
    installed = false
  }
}
