import type { Editor } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'
import { htmlRanges, serializeTable } from '../tables/source'

/** Preserve untouched cells' exact markup, including attributes and comments. */
function preserveCells(raw: string, before: PmNode, rendered: string, after: PmNode): string {
  const oldRanges = htmlRanges(raw).filter(range => /^(td|th)$/.test(range.tag) && range.to >= 0)
  const newRanges = htmlRanges(rendered).filter(range => /^(td|th)$/.test(range.tag) && range.to >= 0)
  const oldCells: PmNode[] = [], newCells: PmNode[] = []
  before.descendants(node => { if (/^table(Cell|Header)$/.test(node.type.name)) oldCells.push(node) })
  after.descendants(node => { if (/^table(Cell|Header)$/.test(node.type.name)) newCells.push(node) })
  if (oldCells.length !== oldRanges.length || newCells.length !== newRanges.length) return rendered
  const originals = new Map(oldCells.map((cell, index) => [cell, raw.slice(oldRanges[index].from, oldRanges[index].to)]))
  const replacements = newCells.flatMap((cell, index) => originals.has(cell) ? [{ ...newRanges[index], raw: originals.get(cell)! }] : [])
  let result = '', offset = 0
  for (const replacement of replacements) {
    if (replacement.from < offset) continue
    result += rendered.slice(offset, replacement.from) + replacement.raw
    offset = replacement.to
  }
  return result + rendered.slice(offset)
}

/** A table-only visual edit must not rewrite unrelated HTML or drop its comments. */
export function spliceHtmlTableChanges(editor: Editor, raw: string, before: PmNode, after: PmNode): string | null {
  const ranges = htmlRanges(raw).filter(range => range.tag === 'table' && range.to >= 0)
  const tables: PmNode[] = []
  before.descendants(node => { if (node.type.name === 'table') tables.push(node) })
  if (tables.length !== ranges.length) return null
  const source = new Map(tables.map((table, index) => [table, ranges[index]]))
  const patches: Array<{ from: number; to: number; value: string }> = []
  const compare = (old: PmNode, next: PmNode): boolean => {
    if (old === next || old.eq(next)) return true
    if (old.type !== next.type) return false
    if (old.isText) return false
    if (old.type.name === 'table') {
      const range = source.get(old)
      if (!range) return false
      const rendered = serializeTable(editor, 'html', next)
      patches.push({ from: range.from, to: range.to, value: preserveCells(raw.slice(range.from, range.to), old, rendered, next) })
      return true
    }
    if (old.type.name !== 'doc' && JSON.stringify(old.attrs) !== JSON.stringify(next.attrs)) return false
    if (old.childCount !== next.childCount) return false
    for (let i = 0; i < old.childCount; i++) if (!compare(old.child(i), next.child(i))) return false
    return !old.isText || old.text === next.text
  }
  if (!compare(before, after)) return null
  let result = raw
  for (const patch of patches.sort((a, b) => b.from - a.from)) result = result.slice(0, patch.from) + patch.value + result.slice(patch.to)
  return result
}
