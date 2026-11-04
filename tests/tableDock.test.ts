import { describe, expect, it } from 'vitest'
import { dockTableBar, type Box } from '../src/renderer/components/tableDock'

const win = { width: 1100, height: 820 }
const viewport: Box = { left: 0, top: 40, right: 1100, bottom: 780 }
const bar = { width: 145, height: 36 }
const overlaps = (p: { left: number; top: number }, b: Box) =>
  p.left < b.right && p.left + bar.width > b.left && p.top < b.bottom && p.top + bar.height > b.top

describe('floating table bar placement', () => {
  it('sits right-aligned above the table when nothing is in the way', () => {
    const table: Box = { left: 171, top: 200, right: 912, bottom: 400 }
    expect(dockTableBar(viewport, table, bar, null, win)).toEqual({ left: 767, top: 159 })
  })

  it('steps left of the find bar instead of covering it (reported case)', () => {
    // measured in the app: table under the find bar at the top right of the editor
    const table: Box = { left: 171, top: 96, right: 912, bottom: 245 }
    const find: Box = { left: 613, top: 50, right: 1082, bottom: 90 }
    const position = dockTableBar(viewport, table, bar, find, win)
    expect(overlaps(position, find)).toBe(false)
    expect(position.left + bar.width).toBeLessThanOrEqual(find.left)
    // still outside the table
    expect(position.top + bar.height).toBeLessThanOrEqual(table.top)
  })

  it('goes below the table when there is no room left of the find bar', () => {
    const table: Box = { left: 20, top: 100, right: 700, bottom: 300 }
    const find: Box = { left: 100, top: 50, right: 1082, bottom: 90 }
    const position = dockTableBar(viewport, table, bar, find, win)
    expect(overlaps(position, find)).toBe(false)
    expect(position.top).toBe(305)
  })

  it('drops under the find bar for a table taller than the viewport', () => {
    const table: Box = { left: 20, top: 0, right: 1000, bottom: 2000 }
    const find: Box = { left: 100, top: 50, right: 1082, bottom: 130 }
    const position = dockTableBar(viewport, table, bar, find, win)
    expect(overlaps(position, find)).toBe(false)
    expect(position.top).toBe(135)
  })

  it('keeps the old placement when the find bar is elsewhere', () => {
    const table: Box = { left: 171, top: 400, right: 912, bottom: 600 }
    const find: Box = { left: 613, top: 50, right: 1082, bottom: 90 }
    expect(dockTableBar(viewport, table, bar, find, win)).toEqual(dockTableBar(viewport, table, bar, null, win))
  })
})
