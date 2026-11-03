import type { Editor } from '@tiptap/core'
import { DOMSerializer, type Node as PmNode } from '@tiptap/pm/model'
import { TableMap } from '@tiptap/pm/tables'
import { parseDocText } from '../markdown/docText'
import { cleanSerializedHtml } from '../html/htmlDocument'
import { BARE_ATTR } from '../html/preserve'
import type { TableKind, TableTarget } from './operations'

interface HtmlRange { tag: string; from: number; openEnd: number; closeStart: number; to: number; parent: HtmlRange | null; children: HtmlRange[] }
const VOID = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '))

/** Source offsets, without reformatting attributes, comments, scripts or surrounding markup. */
export function htmlRanges(source: string): HtmlRange[] {
  const nodes: HtmlRange[] = [], stack: HtmlRange[] = []
  let at = 0
  while (at < source.length) {
    const from = source.indexOf('<', at)
    if (from < 0) break
    if (source.startsWith('<!--', from)) { const end = source.indexOf('-->', from + 4); at = end < 0 ? source.length : end + 3; continue }
    const match = /^<\s*(\/?)\s*([a-z][\w:-]*)\b/i.exec(source.slice(from))
    if (!match) { at = from + 1; continue }
    let end = from + match[0].length, quote = ''
    for (; end < source.length; end++) {
      const char = source[end]
      if (quote) { if (char === quote) quote = '' }
      else if (char === '"' || char === "'") quote = char
      else if (char === '>') break
    }
    if (end === source.length) break
    at = end + 1
    const tag = match[2].toLowerCase()
    if (match[1]) {
      const node = stack[stack.length - 1]
      if (node?.tag === tag) { node.closeStart = from; node.to = at; stack.pop() }
      else {
        // Ambiguous or omitted closing tags are left to the source editor.
        const index = stack.findLastIndex(item => item.tag === tag)
        if (index >= 0) stack.splice(index)
      }
      continue
    }
    const parent = stack[stack.length - 1] ?? null
    const node: HtmlRange = { tag, from, openEnd: at, closeStart: -1, to: -1, parent, children: [] }
    nodes.push(node); parent?.children.push(node)
    if (VOID.has(tag) || /\/\s*>$/.test(source.slice(from, at))) { node.closeStart = end; node.to = at; continue }
    if (/^(script|style|textarea|title)$/.test(tag)) {
      const close = new RegExp(`</${tag}\\s*>`, 'ig'); close.lastIndex = at
      const found = close.exec(source)
      if (found) { node.closeStart = found.index; node.to = close.lastIndex; at = close.lastIndex }
      else break
    } else stack.push(node)
  }
  return nodes
}

interface CellRange { from: number; to: number; row: number; col: number }
export interface SourceTable { from: number; to: number; cells: CellRange[] }

function pipeCells(line: string, start: number, row: number): CellRange[] {
  const cuts: number[] = []
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\') { i++; continue }
    if (line[i] === '|') cuts.push(i)
  }
  const first = line.search(/\S/), last = line.trimEnd().length - 1
  const boundaries = [...(cuts[0] === first ? [] : [-1]), ...cuts, ...(cuts[cuts.length - 1] === last ? [] : [line.length])]
  return boundaries.slice(0, -1).map((left, col) => ({ from: start + left + 1, to: start + boundaries[col + 1], row, col }))
}

const tableCache = new WeakMap<Editor, { raw: string; kind: TableKind; tables: SourceTable[] }>()

export function sourceTables(editor: Editor, kind: TableKind, raw: string): SourceTable[] {
  const cached = tableCache.get(editor)
  if (cached?.kind === kind && cached.raw === raw) return cached.tables
  const tables = scanSourceTables(editor, kind, raw)
  tableCache.set(editor, { raw, kind, tables })
  return tables
}

function scanSourceTables(editor: Editor, kind: TableKind, raw: string): SourceTable[] {
  if (kind === 'html') {
    const nodes = htmlRanges(raw)
    return nodes.filter(node => node.tag === 'table' && node.to >= 0).map(table => {
      const rows = table.children.flatMap(child => /^(thead|tbody|tfoot)$/.test(child.tag) ? child.children.filter(item => item.tag === 'tr') : child.tag === 'tr' ? [child] : [])
      return { from: table.from, to: table.to, cells: rows.flatMap((row, i) => row.children.filter(cell => /^(td|th)$/.test(cell.tag) && cell.to >= 0).map((cell, col) => ({ from: cell.openEnd, to: cell.closeStart, row: i, col }))) }
    })
  }
  const body = parseDocText(raw).body, base = raw.indexOf(body)
  const instance = editor.markdown?.instance
  if (!instance) return []
  const tokens = new instance.Lexer(instance.defaults).lex(body)
  let offset = base
  const out: SourceTable[] = []
  for (const token of tokens) {
    const from = offset; offset += token.raw.length
    if (token.type !== 'table') continue
    let lineStart = from
    const cells = token.raw.split('\n').flatMap((line, i) => {
      const result = i === 1 || !line.trim() ? [] : pipeCells(line, lineStart, i === 0 ? 0 : i - 1)
      lineStart += line.length + 1
      return result
    })
    out.push({ from, to: offset, cells })
  }
  return out
}

export function sourceTableTarget(editor: Editor, kind: TableKind, raw: string, selection: { from: number; to: number }): { target: TableTarget; source: SourceTable } | null {
  const tables = sourceTables(editor, kind, raw), pm: Array<{ table: PmNode; pos: number }> = []
  editor.state.doc.descendants((table, pos) => { if (table.type.name === 'table') pm.push({ table, pos }) })
  // Never guess between tables if a nonstandard/malformed source parsed differently.
  if (pm.length !== tables.length) return null
  const index = tables.findIndex(table => selection.from >= table.from && selection.to <= table.to)
  if (index < 0) return null
  const source = tables[index], { table, pos } = pm[index], map = TableMap.get(table)
  let cells = source.cells.filter(cell => selection.from === selection.to
    ? selection.from >= cell.from - 1 && selection.from <= cell.to
    : selection.from < cell.to && selection.to > cell.from)
  if (!cells.length && kind === 'markdown') {
    const lineStart = raw.lastIndexOf('\n', selection.from - 1) + 1
    const lineEnd = raw.indexOf('\n', selection.from)
    cells = source.cells.filter(cell => cell.from >= lineStart && cell.from < (lineEnd < 0 ? raw.length : lineEnd))
    const line = raw.slice(lineStart, lineEnd < 0 ? raw.length : lineEnd)
    if (!cells.length && /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/.test(line)) {
      cells = pipeCells(line, lineStart, 0).filter(cell => selection.from >= cell.from - 1 && selection.from <= cell.to)
    }
  }
  if (!cells.length) return null
  const logical = cells.map(cell => {
    if (cell.row >= table.childCount || cell.col >= table.child(cell.row).childCount) return null
    let offset = 1
    for (let row = 0; row < cell.row; row++) offset += table.child(row).nodeSize
    for (let col = 0; col < cell.col; col++) offset += table.child(cell.row).child(col).nodeSize
    return map.findCell(offset)
  })
  if (logical.some(cell => !cell)) return null
  return { source, target: { table, pos, top: Math.min(...logical.map(cell => cell!.top)), bottom: Math.max(...logical.map(cell => cell!.bottom)), left: Math.min(...logical.map(cell => cell!.left)), right: Math.max(...logical.map(cell => cell!.right)) } }
}

export function serializeTable(editor: Editor, kind: TableKind, table: PmNode): string {
  if (kind === 'markdown') return editor.markdown!.serialize({ type: 'doc', content: [table.toJSON()] }).trim()
  const holder = document.createElement('div')
  holder.append(DOMSerializer.fromSchema(editor.schema).serializeNode(table))
  return cleanSerializedHtml(holder.innerHTML, BARE_ATTR)
}

export function replaceSourceTable(raw: string, source: SourceTable, replacement: string): string {
  const trailing = /\n*$/.exec(raw.slice(source.from, source.to))![0]
  return raw.slice(0, source.from) + replacement + (replacement ? trailing : '') + raw.slice(source.to)
}
