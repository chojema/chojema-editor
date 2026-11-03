import { useEffect, useReducer } from 'react'
import type { Editor } from '@tiptap/core'
import { DOMSerializer } from '@tiptap/pm/model'
import { TableMap } from '@tiptap/pm/tables'
import type { ViewModes } from '../views'
import { showToast } from '../components/toast-bus'
import { t } from '../i18n/locale'
import { canTableAction, editTable, insertTable, selectedTable, selectTableTarget, type TableAction, type TableKind } from './operations'
import { htmlRanges, serializeTable, sourceTableTarget, sourceTables, replaceSourceTable } from './source'

export function useTableTools(editor: Editor | null, kind: TableKind, views: ViewModes) {
  const [, refresh] = useReducer(value => value + 1, 0)
  useEffect(() => {
    if (!editor) return
    editor.on('selectionUpdate', refresh)
    editor.on('update', refresh)
    return () => { editor.off('selectionUpdate', refresh); editor.off('update', refresh) }
  }, [editor])
  const inSource = () => views.mode === 'source' || views.lastPaneRef.current === 'source'
  const sourceContext = () => {
    const source = views.sourceRef.current
    if (!editor || !source) return null
    return sourceTableTarget(editor, kind, source.getValue().replace(/\r\n/g, '\n'), source.selection())
  }
  const target = editor ? inSource() ? sourceContext()?.target ?? null : selectedTable(editor) : null
  const insideTable = Boolean(target) || Boolean(editor?.isActive('preservedHtmlTable')) || Boolean(editor && inSource() && views.sourceRef.current && sourceTables(editor, kind, views.sourceRef.current.getValue().replace(/\r\n/g, '\n')).some(table => {
    const selection = views.sourceRef.current!.selection()
    return selection.from >= table.from && selection.from <= table.to
  }))
  const prepare = () => {
    views.settle()
    if (!editor) return null
    if (inSource()) {
      const context = sourceContext()
      if (context) selectTableTarget(editor, context.target)
      refresh()
      return context
    }
    refresh()
    return null
  }
  const fail = () => { showToast(t('tableActionUnavailable'), 'error'); return false }
  const run = (action: TableAction, amount = 1): boolean => {
    if (!editor) return false
    const sourceMode = inSource(), context = prepare()
    if (sourceMode && !context) return fail()
    const raw = sourceMode ? views.sourceRef.current!.getValue() : ''
    const before = editor.state.doc
    try { if (!editTable(editor, kind, action, amount)) return fail() } catch { return fail() }
    if (sourceMode && context) {
      if (action === 'selectRows' || action === 'selectColumns') {
        const now = selectedTable(editor)!
        const cells = context.source.cells.filter(cell => cell.row >= now.top && cell.row < now.bottom && cell.col >= now.left && cell.col < now.right)
        if (cells.length) views.sourceRef.current!.setSelection(Math.min(...cells.map(cell => cell.from)), Math.max(...cells.map(cell => cell.to)))
      } else {
        const normalized = raw.replace(/\r\n/g, '\n')
        const changed = editor.state.doc.nodeAt(context.target.pos)
        let replacement = action === 'deleteTable' ? '' : changed?.type.name === 'table' ? serializeTable(editor, kind, changed) : null
        if (replacement === null) {
          // Keep the source intact if an unexpected schema changed the target.
          editor.commands.setContent(before.toJSON(), { emitUpdate: false })
          return fail()
        }
        const next = replaceSourceTable(normalized, context.source, replacement)
        views.applySourceEdit(raw.includes('\r\n') ? next.replace(/\n/g, '\r\n') : next)
      }
      views.activate('source'); views.sourceRef.current?.focus()
    } else { editor.commands.focus(); editor.view.focus() }
    refresh()
    return true
  }
  const create = (rows: number, cols: number, header: boolean): boolean => {
    if (!editor) return false
    prepare()
    if (!inSource()) {
      const ok = insertTable(editor, kind, rows, cols, header)
      if (!ok) return fail()
      editor.commands.focus(); editor.view.focus(); refresh(); return true
    }
    const source = views.sourceRef.current!
    const raw = source.getValue(), normalized = raw.replace(/\r\n/g, '\n'), selection = source.selection()
    if (sourceTables(editor, kind, normalized).some(table => selection.from >= table.from && selection.from <= table.to)) return fail()
    if (sourceContext() || !Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || rows > 100 || cols < 1 || cols > 30) return fail()
    const table = editor.schema.nodes.table.create(null, Array.from({ length: rows }, (_, row) => editor.schema.nodes.tableRow.create(null,
      Array.from({ length: cols }, () => (row === 0 && (kind === 'markdown' || header) ? editor.schema.nodes.tableHeader : editor.schema.nodes.tableCell).createAndFill()!))))
    let at = selection.from
    if (htmlRanges(normalized).some(node => node.tag === 'table' && at >= node.from && at < node.to)) return fail()
    if (kind === 'html') {
      const nodes = htmlRanges(normalized)
      if (nodes.some(node => at >= node.from && at < node.openEnd || node.closeStart >= 0 && at > node.closeStart && at < node.to)) return fail()
      if (nodes.some(node => node.tag === 'table' && at >= node.from && at < node.to)) return fail()
      // A block inserted while editing a paragraph belongs after that block, never inside its tag/text.
      const enclosing = nodes.filter(node => node.to >= 0 && at >= node.openEnd && at <= node.closeStart && /^(p|h[1-6]|pre)$/.test(node.tag)).at(-1)
      if (enclosing) at = enclosing.to
    }
    let markup: string
    if (kind === 'markdown') markup = serializeTable(editor, kind, table)
    else {
      const holder = document.createElement('div'); holder.append(DOMSerializer.fromSchema(editor.schema).serializeNode(table)); markup = holder.innerHTML
    }
    const text = normalized.slice(0, at) + '\n\n' + markup + '\n\n' + normalized.slice(at)
    views.applySourceEdit(raw.includes('\r\n') ? text.replace(/\n/g, '\r\n') : text)
    source.setSelection(at + 2, at + 2); source.focus(); refresh(); return true
  }
  return {
    editor, kind, target, insideTable, views, prepare, run, create, refresh,
    can(action: TableAction) {
      if (!editor || !target) return false
      const map = TableMap.get(target.table)
      if (action === 'deleteRow') return target.bottom - target.top < map.height
      if (action === 'deleteColumn') return target.right - target.left < map.width
      return canTableAction(editor, kind, action, target)
    },
  }
}

export type TableTools = ReturnType<typeof useTableTools>
