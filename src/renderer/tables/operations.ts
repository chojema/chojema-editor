import type { Editor } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'
import { CellSelection, TableMap, cellAround, addRowBefore, addRowAfter, addColumnBefore, addColumnAfter, deleteRow, deleteColumn, deleteTable, toggleHeaderRow, mergeCells, splitCell } from '@tiptap/pm/tables'
import { EditorState, Selection, type Command } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import type { TableExtras } from '../html/table'

export type TableKind = 'markdown' | 'html'
export type TableAction = 'addRowBefore' | 'addRowAfter' | 'deleteRow' | 'addColumnBefore' | 'addColumnAfter' | 'deleteColumn' | 'deleteTable' | 'selectRows' | 'selectColumns' | 'toggleHeaderRow' | 'mergeCells' | 'splitCell' | 'setColumnWidth'
export interface TableTarget { pos: number; table: PmNode; top: number; bottom: number; left: number; right: number }

export function selectedTable(editor: Editor): TableTarget | null {
  const { selection } = editor.state
  const $cell = selection instanceof CellSelection ? selection.$anchorCell : cellAround(selection.$from)
  if (!$cell) return null
  const table = $cell.node(-1), start = $cell.start(-1), map = TableMap.get(table)
  const rect = selection instanceof CellSelection
    ? map.rectBetween(selection.$anchorCell.pos - start, selection.$headCell.pos - start)
    : map.findCell($cell.pos - start)
  return { pos: start - 1, table, ...rect }
}

export function selectTableTarget(editor: Editor, target: TableTarget): boolean {
  const map = TableMap.get(target.table), start = target.pos + 1
  const anchor = map.map[target.top * map.width + target.left]
  const head = map.map[(target.bottom - 1) * map.width + target.right - 1]
  if (anchor === undefined || head === undefined) return false
  editor.commands.setCellSelection({ anchorCell: start + anchor, headCell: start + head })
  return true
}

const copyAttrs = (attrs: Record<string, unknown>) => {
  const copy = { ...attrs }
  if (copy.htmlAttrs) {
    const html = { ...(copy.htmlAttrs as Record<string, string>) }
    for (const name of ['id', 'headers', 'scope']) delete html[name]
    copy.htmlAttrs = Object.keys(html).length ? html : null
  }
  return copy
}

/** Column definitions belong to the logical grid, including HTML col span attributes. */
function columnGroups(meta: TableExtras | null, width: number): HTMLElement[] {
  const groups: HTMLElement[] = []
  for (const markup of meta?.columns ?? []) {
    const holder = document.createElement('template'); holder.innerHTML = markup
    const group = holder.content.firstElementChild as HTMLElement | null
    if (!group) continue
    for (const col of Array.from(group.children)) {
      const span = Math.min(1000, Math.max(1, Number(col.getAttribute('span')) || 1))
      col.removeAttribute('span')
      for (let i = 1; i < span; i++) group.insertBefore(col.cloneNode(true), col)
    }
    if (!group.children.length) {
      const span = Math.min(1000, Math.max(1, Number(group.getAttribute('span')) || 1))
      group.removeAttribute('span')
      for (let i = 0; i < span; i++) group.append(document.createElement('col'))
    }
    groups.push(group)
  }
  if (!groups.length) {
    const group = document.createElement('colgroup')
    for (let i = 0; i < width; i++) group.append(document.createElement('col'))
    groups.push(group)
  }
  return groups
}

export function canTableAction(editor: Editor, kind: TableKind, action: TableAction, target = selectedTable(editor)): boolean {
  if (!target) return false
  const map = TableMap.get(target.table)
  if (kind === 'markdown' && ['toggleHeaderRow', 'mergeCells', 'splitCell', 'setColumnWidth'].includes(action)) return false
  if (action === 'deleteRow') return target.bottom - target.top < map.height
  if (action === 'deleteColumn') return target.right - target.left < map.width
  if (action === 'mergeCells') {
    const section = JSON.stringify(target.table.child(target.top).attrs.htmlSection)
    for (let row = target.top + 1; row < target.bottom; row++) if (JSON.stringify(target.table.child(row).attrs.htmlSection) !== section) return false
    const selection = CellSelection.create(editor.state.doc, target.pos + 1 + map.map[target.top * map.width + target.left], target.pos + 1 + map.map[(target.bottom - 1) * map.width + target.right - 1])
    return mergeCells(EditorState.create({ schema: editor.schema, doc: editor.state.doc, selection }))
  }
  if (action === 'splitCell') {
    const selection = CellSelection.create(editor.state.doc, target.pos + 1 + map.map[target.top * map.width + target.left], target.pos + 1 + map.map[(target.bottom - 1) * map.width + target.right - 1])
    return splitCell(EditorState.create({ schema: editor.schema, doc: editor.state.doc, selection }))
  }
  return true
}

export function editTable(editor: Editor, kind: TableKind, action: TableAction, amount = 1): boolean {
  const target = selectedTable(editor)
  if (!target || !canTableAction(editor, kind, action)) return false
  const map = TableMap.get(target.table)
  if (action === 'selectRows' || action === 'selectColumns') {
    return selectTableTarget(editor, action === 'selectRows'
      ? { ...target, left: 0, right: map.width }
      : { ...target, top: 0, bottom: map.height })
  }
  if (!Number.isInteger(amount) || amount < 1 || amount > (action === 'setColumnWidth' ? 2000 : 100)) return false
  const rowInsert = action === 'addRowBefore' || action === 'addRowAfter'
  const colInsert = action === 'addColumnBefore' || action === 'addColumnAfter'
  const count = rowInsert || colInsert ? amount : 1
  if (rowInsert && map.height + count > 1000 || colInsert && map.width + count > 100) return false
  const before = editor.state.doc
  const chain = editor.chain().command(({ tr }) => { closeHistory(tr); return true })
  if (action !== 'setColumnWidth') chain.command(({ tr }) => {
    const commands: Record<string, Command> = { addRowBefore, addRowAfter, addColumnBefore, addColumnAfter, deleteRow, deleteColumn, deleteTable, toggleHeaderRow, mergeCells, splitCell }
    for (let i = 0; i < count; i++) {
      // Table commands map positions internally; each repeated operation needs
      // a fresh mapping while its steps still belong to one undo transaction.
      const state = EditorState.create({ schema: editor.schema, doc: tr.doc, selection: tr.selection })
      if (!commands[action](state, next => {
        for (const step of next.steps) tr.step(step)
        tr.setSelection(Selection.fromJSON(tr.doc, next.selection.toJSON()))
      })) return false
    }
    return true
  })
  chain.command(({ tr }) => {
    if (action === 'deleteTable') return true
    const table = tr.doc.nodeAt(target.pos)
    if (!table || table.type.name !== 'table') return false
    const nextMap = TableMap.get(table), start = target.pos + 1
    const rowAt = action === 'addRowBefore' ? target.top : target.bottom
    const colAt = action === 'addColumnBefore' ? target.left : target.right
    if (kind === 'html') {
      const oldRow = target.table.child(Math.min(target.top, map.height - 1))
      let rowPos = start
      table.forEach((row, _offset, rowIndex) => {
        const addedRow = rowInsert && rowIndex >= rowAt && rowIndex < rowAt + count
        if (addedRow) tr.setNodeMarkup(rowPos, undefined, copyAttrs(oldRow.attrs))
        let cellPos = rowPos + 1
        row.forEach(cell => {
          const col = nextMap.colCount(cellPos - start)
          const addedCell = addedRow || colInsert && col >= colAt && col < colAt + count
          if (addedCell) {
            const sourceRow = addedRow ? target.top : Math.min(rowIndex, map.height - 1)
            const sourceCol = colInsert ? target.left : Math.min(col, map.width - 1)
            const reference = target.table.nodeAt(map.map[sourceRow * map.width + sourceCol])
            if (reference) tr.setNodeMarkup(cellPos, undefined, { ...cell.attrs, htmlAttrs: copyAttrs(reference.attrs).htmlAttrs ?? null, bare: reference.attrs.bare ?? false })
          }
          cellPos += cell.nodeSize
        })
        rowPos += row.nodeSize
      })
      const meta = target.table.attrs.htmlTableExtras as TableExtras | null
      if (colInsert || action === 'deleteColumn' || action === 'setColumnWidth') {
        if (meta?.columns.length || action === 'setColumnWidth') {
          const groups = columnGroups(meta, map.width)
          const cols = groups.flatMap(group => Array.from(group.children))
          if (colInsert) {
            const ref = cols[Math.min(target.left, cols.length - 1)]
            const parent = cols[colAt]?.parentElement ?? groups[groups.length - 1]
            for (let i = 0; i < count; i++) {
              const col = ref?.cloneNode(true) as Element ?? document.createElement('col')
              col.removeAttribute('id')
              parent.insertBefore(col, cols[colAt] ?? null)
            }
          } else if (action === 'deleteColumn') cols.slice(target.left, target.right).forEach(col => col.remove())
          else for (const col of cols.slice(target.left, target.right)) (col as HTMLElement).style.width = `${amount}px`
          tr.setNodeMarkup(target.pos, undefined, { ...tr.doc.nodeAt(target.pos)!.attrs, htmlTableExtras: { ...meta, caption: meta?.caption ?? null, columns: groups.filter(group => group.children.length).map(group => group.outerHTML) } })
        }
      }
    } else {
      // Deleting/inserting the first row must not manufacture an extra empty header on save.
      let rowPos = start
      table.forEach((row, _offset, index) => {
        const type = index === 0 ? editor.schema.nodes.tableHeader : editor.schema.nodes.tableCell
        let pos = rowPos + 1
        row.forEach(cell => {
          if (cell.type !== type) tr.setNodeMarkup(pos, type, cell.attrs)
          pos += cell.nodeSize
        })
        rowPos += row.nodeSize
      })
    }
    return true
  })
  const ok = chain.run() && !editor.state.doc.eq(before)
  if (ok) editor.view.dispatch(closeHistory(editor.state.tr))
  return ok
}

export function insertTable(editor: Editor, kind: TableKind, rows: number, cols: number, header = true): boolean {
  if (selectedTable(editor) || editor.isActive('preservedHtmlTable') || !Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1 || rows > 100 || cols > 30) return false
  const before = editor.state.doc
  editor.chain().command(({ tr }) => { closeHistory(tr); return true }).insertTable({ rows, cols, withHeaderRow: kind === 'markdown' || header }).run()
  if (editor.state.doc.eq(before)) return false
  editor.view.dispatch(closeHistory(editor.state.tr))
  return true
}
