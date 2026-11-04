/** a box in viewport coordinates */
export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

const GAP = 5
const EDGE = 6

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

/** keep a bar of this size inside the window, as the table popovers do */
function inWindow(left: number, top: number, width: number, height: number, win: { width: number; height: number }) {
  return {
    left: Math.max(8, Math.min(left, win.width - width - 8)),
    top: Math.max(8, Math.min(top, win.height - height - 8)),
  }
}

/**
 * Where the floating table bar goes: right-aligned just above the table, else
 * just below it, else pinned to the top of the viewport (a table taller than
 * the viewport). It stays outside the table so it never covers cells the user
 * may click next, and it steps around `avoid` (the find bar), which sits at
 * the top right of the editor where the bar would otherwise land on it.
 */
export function dockTableBar(
  viewport: Box,
  table: Box,
  bar: { width: number; height: number },
  avoid: Box | null,
  win: { width: number; height: number } = { width: window.innerWidth, height: window.innerHeight },
): { left: number; top: number } {
  const { width, height } = bar
  const place = (left: number, top: number) => {
    const position = inWindow(left, top, width, height, win)
    position.top = Math.max(viewport.top + EDGE, Math.min(position.top, viewport.bottom - height - EDGE))
    return position
  }
  const box = (position: { left: number; top: number }): Box => ({
    left: position.left,
    top: position.top,
    right: position.left + width,
    bottom: position.top + height,
  })
  const clear = (position: { left: number; top: number }) => !avoid || !overlaps(box(position), avoid)

  const right = Math.max(table.left, table.right - width)
  const above = table.top - height - GAP
  const below = table.bottom + GAP
  const fitsAbove = above >= viewport.top + EDGE
  const fitsBelow = below + height <= viewport.bottom - EDGE
  const first = place(right, fitsAbove ? above : fitsBelow ? below : viewport.top + EDGE)
  if (clear(first) || !avoid) return first

  const candidates: { left: number; top: number }[] = []
  // same row, moved left of the find bar: still outside the table
  const leftOfAvoid = avoid.left - width - GAP
  if (leftOfAvoid >= viewport.left + EDGE) candidates.push(place(Math.min(right, leftOfAvoid), first.top))
  if (fitsAbove && fitsBelow) candidates.push(place(right, below))
  // under the find bar, as close to the original spot as possible
  candidates.push(place(right, Math.max(first.top, avoid.bottom + GAP)))
  return candidates.find(clear) ?? candidates[candidates.length - 1]
}
