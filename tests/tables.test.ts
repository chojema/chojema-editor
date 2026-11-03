import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { TableMap } from '@tiptap/pm/tables'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { buildHtmlExtensions } from '../src/renderer/html/htmlExtensions'
import { editTable, insertTable, selectTableTarget, type TableKind } from '../src/renderer/tables/operations'
import { serializeTable, sourceTableTarget, replaceSourceTable } from '../src/renderer/tables/source'
import { cleanSerializedHtml } from '../src/renderer/html/htmlDocument'
import { BARE_ATTR } from '../src/renderer/html/preserve'
import { spliceHtmlTableChanges } from '../src/renderer/html/tableSplice'

const editors: Editor[] = []
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()) })
const MD = '| A | B | C | D |\n|---|---|---|---|\n| a1 | b1 | c1 | d1 |\n| a2 | b2 | c2 | d2 |\n| a3 | b3 | c3 | d3 |'
const HTML = '<table class="grid"><caption><b>Title</b></caption><colgroup class="cols"><col style="width:80px"><col style="width:140px"></colgroup><thead class="head"><tr><th scope="col">A</th><th>B</th></tr></thead><tbody class="body"><tr id="original"><td id="unique" class="c" style="background-color:yellow">x</td><td>y</td></tr></tbody><tfoot class="foot"><tr><td>sum</td><td>1</td></tr></tfoot></table>'
function open(kind: TableKind, raw: string) {
  const editor = new Editor({ extensions: kind === 'html' ? buildHtmlExtensions() : buildExtensions({ slashController: { onOpen() {}, onUpdate() {}, onKeyDown: () => false, onClose() {} }, slashItems: () => [] }) })
  editors.push(editor)
  editor.chain().setMeta('addToHistory', false).setContent(raw, { contentType: kind, emitUpdate: false }).run()
  return editor
}
function select(editor: Editor, top: number, bottom: number, left: number, right: number) {
  const table = editor.state.doc.firstChild!
  expect(selectTableTarget(editor, { pos: 0, table, top, bottom, left, right })).toBe(true)
}
const html = (editor: Editor) => cleanSerializedHtml(editor.getHTML(), BARE_ATTR)

describe('Markdown table safety', () => {
  it('preserves complex embedded HTML tables as source-editable atoms', () => {
    const editor = open('markdown', HTML)
    expect(editor.state.doc.firstChild!.type.name).toBe('preservedHtmlTable')
    expect(editor.getMarkdown().trim()).toBe(HTML)
    expect(open('markdown', editor.getMarkdown()).getJSON()).toEqual(editor.getJSON())
  })
  it('rejects nested insertion and header removal without changing the document', () => {
    const editor = open('markdown', MD)
    select(editor, 1, 2, 0, 1)
    const before = editor.getJSON()
    expect(insertTable(editor, 'markdown', 3, 3)).toBe(false)
    editor.commands.insertTable({ rows: 3, cols: 3, withHeaderRow: true })
    expect(editor.getJSON()).toEqual(before)
    editor.commands.toggleHeaderRow()
    expect(editor.getJSON()).toEqual(before)
    expect(editTable(editor, 'markdown', 'mergeCells')).toBe(false)
  })
  it('promotes exactly the new first row when deleting the header', () => {
    const editor = open('markdown', MD)
    select(editor, 0, 1, 0, 1)
    expect(editTable(editor, 'markdown', 'deleteRow')).toBe(true)
    const saved = editor.getMarkdown(), reopened = open('markdown', saved)
    expect(reopened.getJSON()).toEqual(editor.getJSON())
    expect(reopened.state.doc.firstChild!.childCount).toBe(3)
    expect(saved).not.toMatch(/^\|\s*\|/)
  })
  it('inserts before the header without leaving extra header rows after reopening', () => {
    const editor = open('markdown', MD)
    select(editor, 0, 1, 0, 1)
    expect(editTable(editor, 'markdown', 'addRowBefore', 2)).toBe(true)
    expect(open('markdown', editor.getMarkdown()).getJSON()).toEqual(editor.getJSON())
    expect(editor.state.doc.firstChild!.childCount).toBe(6)
  })
  it('inserts chosen dimensions and rejects invalid sizes', () => {
    const editor = open('markdown', 'text')
    expect(insertTable(editor, 'markdown', 5, 7, false)).toBe(true)
    let table
    editor.state.doc.descendants(node => { if (node.type.name === 'table') table = node })
    expect(TableMap.get(table!)).toMatchObject({ width: 7, height: 5 })
    expect(insertTable(editor, 'markdown', 0, 7)).toBe(false)
  })
})

describe('table ranges and history', () => {
  it('deletes two selected rows as one undo step', () => {
    const editor = open('markdown', MD), original = editor.getJSON()
    select(editor, 1, 3, 0, 2)
    expect(editTable(editor, 'markdown', 'deleteRow')).toBe(true)
    expect(TableMap.get(editor.state.doc.firstChild!).height).toBe(2)
    editor.commands.undo(); expect(editor.getJSON()).toEqual(original)
    editor.commands.redo(); expect(TableMap.get(editor.state.doc.firstChild!).height).toBe(2)
  })
  it('adds multiple columns as one undo step and deletes a column range', () => {
    const editor = open('markdown', MD), original = editor.getJSON()
    select(editor, 1, 3, 1, 3)
    expect(editTable(editor, 'markdown', 'addColumnAfter', 3)).toBe(true)
    expect(TableMap.get(editor.state.doc.firstChild!).width).toBe(7)
    editor.commands.undo(); expect(editor.getJSON()).toEqual(original)
    select(editor, 1, 3, 1, 3)
    expect(editTable(editor, 'markdown', 'deleteColumn')).toBe(true)
    expect(TableMap.get(editor.state.doc.firstChild!).width).toBe(2)
  })
  it('rejects removing all rows or columns through partial-delete commands', () => {
    const editor = open('markdown', MD), original = editor.getJSON()
    select(editor, 0, 4, 0, 4)
    expect(editTable(editor, 'markdown', 'deleteRow')).toBe(false)
    expect(editTable(editor, 'markdown', 'deleteColumn')).toBe(false)
    expect(editor.getJSON()).toEqual(original)
  })
})

describe('HTML table preservation', () => {
  it('splices visual table edits without rewriting unrelated HTML or unchanged cells', () => {
    const raw = '<!--before--><div data-x="1 > 0"><p>untouched</p>' + HTML.replace('>y<', '><!--cell-->y<') + '</div><!--after-->'
    const editor = open('html', raw), original = editor.state.doc
    let pos = -1
    editor.state.doc.descendants((node, at) => { if (node.isText && node.text === 'x') pos = at })
    editor.commands.insertContentAt(pos + 1, '!')
    const saved = spliceHtmlTableChanges(editor, raw, original, editor.state.doc)!
    expect(saved).not.toBeNull()
    expect(saved.startsWith('<!--before--><div data-x="1 > 0"><p>untouched</p>')).toBe(true)
    expect(saved.endsWith('</div><!--after-->')).toBe(true)
    expect(saved).toContain('<!--cell-->y')
    expect(saved).toContain('x!')
  })
  it('does not mistake a non-table formatting change for an unchanged body', () => {
    const raw = '<p>outside</p>' + HTML, editor = open('html', raw), before = editor.state.doc
    editor.chain().setTextSelection({ from: 1, to: 8 }).toggleBold().run()
    expect(spliceHtmlTableChanges(editor, raw, before, editor.state.doc)).toBeNull()
  })
  it('rejects merging cells across separate table sections', () => {
    const editor = open('html', HTML)
    select(editor, 0, 2, 0, 2)
    expect(editTable(editor, 'html', 'mergeCells')).toBe(false)
  })
  it('retains caption, sections, section attributes, column definitions and scope through editing/reopening', () => {
    const editor = open('html', HTML)
    select(editor, 1, 2, 0, 1)
    expect(editTable(editor, 'html', 'addRowAfter', 2)).toBe(true)
    const saved = html(editor), template = document.createElement('template'); template.innerHTML = saved
    expect(template.content.querySelector('caption')!.innerHTML).toBe('<b>Title</b>')
    expect(template.content.querySelector('thead.head th[scope="col"]')?.textContent).toBe('A')
    expect(template.content.querySelector('tfoot.foot')?.textContent).toBe('sum1')
    expect(template.content.querySelectorAll('tbody.body tr')).toHaveLength(3)
    expect(template.content.querySelectorAll('#original')).toHaveLength(1)
    expect(template.content.querySelectorAll('#unique')).toHaveLength(1)
    expect(template.content.querySelectorAll('colgroup.cols col')).toHaveLength(2)
    expect(template.content.querySelector('col')?.getAttribute('style')).toBe('width:80px')
    expect(html(open('html', saved))).toBe(saved)
  })
  it('inherits cell formatting without duplicating IDs', () => {
    const editor = open('html', HTML)
    select(editor, 1, 2, 0, 1)
    expect(editTable(editor, 'html', 'addRowAfter', 2)).toBe(true)
    const holder = document.createElement('div'); holder.innerHTML = html(editor)
    expect(holder.querySelectorAll('td.c')).toHaveLength(3)
    expect(holder.querySelectorAll('#unique')).toHaveLength(1)
    expect(Array.from(holder.querySelectorAll('td.c')).every(cell => (cell as HTMLElement).style.backgroundColor === 'yellow')).toBe(true)
  })
  it('updates column metadata for insert/delete and explicit width', () => {
    const editor = open('html', HTML)
    select(editor, 1, 2, 0, 1)
    expect(editTable(editor, 'html', 'addColumnAfter', 2)).toBe(true)
    let holder = document.createElement('div'); holder.innerHTML = html(editor)
    expect(holder.querySelectorAll('col')).toHaveLength(4)
    select(editor, 1, 2, 1, 3)
    expect(editTable(editor, 'html', 'setColumnWidth', 175)).toBe(true)
    holder.innerHTML = html(editor)
    expect((holder.querySelectorAll('col')[1] as HTMLElement).style.width).toBe('175px')
    expect(editTable(editor, 'html', 'deleteColumn')).toBe(true)
    holder.innerHTML = html(editor); expect(holder.querySelectorAll('col')).toHaveLength(2)
    expect(html(open('html', html(editor)))).toBe(html(editor))
  })
  it('merges and splits cells without losing text or table metadata', () => {
    const editor = open('html', HTML)
    select(editor, 1, 2, 0, 2)
    expect(editTable(editor, 'html', 'mergeCells')).toBe(true)
    expect(html(editor)).toContain('colspan="2"')
    expect(editor.state.doc.textContent).toContain('xy')
    expect(editTable(editor, 'html', 'splitCell')).toBe(true)
    expect(html(editor)).not.toContain('colspan="2"')
    expect(html(editor)).toContain('<caption><b>Title</b></caption>')
  })
})

describe('source table targeting', () => {
  it('maps full Markdown row ranges and duplicate tables without touching surrounding source', () => {
    const raw = 'before\n\n' + MD + '\n\n' + MD + '\n\nafter\n', editor = open('markdown', raw)
    const from = raw.lastIndexOf('| a1'), to = raw.lastIndexOf('| a3')
    const context = sourceTableTarget(editor, 'markdown', raw, { from, to })!
    expect(context).not.toBeNull()
    expect(context.source.from).toBe(raw.lastIndexOf(MD))
    expect(context.target).toMatchObject({ top: 1, bottom: 3, left: 0, right: 4 })
    selectTableTarget(editor, context.target); expect(editTable(editor, 'markdown', 'deleteRow')).toBe(true)
    const replacement = serializeTable(editor, 'markdown', editor.state.doc.nodeAt(context.target.pos)!)
    const saved = replaceSourceTable(raw, context.source, replacement)
    expect(saved.startsWith('before\n\n' + MD + '\n\n')).toBe(true)
    expect(saved.endsWith('\nafter\n')).toBe(true)
  })
  it('maps HTML spans and preserves comments and unrelated attributes outside the table', () => {
    const raw = '<!--before--><p data-x="1 > 0">keep</p><table><tr><th colspan="2">H</th></tr><tr><td>a</td><td>b</td></tr></table><!--after-->'
    const editor = open('html', raw), from = raw.indexOf('>b<') + 1
    const context = sourceTableTarget(editor, 'html', raw, { from, to: from })!
    expect(context.target).toMatchObject({ top: 1, bottom: 2, left: 1, right: 2 })
    selectTableTarget(editor, context.target); expect(editTable(editor, 'html', 'addRowAfter', 2)).toBe(true)
    const replacement = serializeTable(editor, 'html', editor.state.doc.nodeAt(context.target.pos)!)
    const saved = raw.slice(0, context.source.from) + replacement + raw.slice(context.source.to)
    expect(saved.startsWith('<!--before--><p data-x="1 > 0">keep</p>')).toBe(true)
    expect(saved.endsWith('<!--after-->')).toBe(true)
  })
  it('does not treat a fenced Markdown table or HTML script string as a source table', () => {
    const raw = '```\n' + MD + '\n```\n', editor = open('markdown', raw), from = raw.indexOf('a1')
    expect(sourceTableTarget(editor, 'markdown', raw, { from, to: from })).toBeNull()
    const htmlRaw = '<script>const t="<table><tr><td>not a table</td></tr></table>";</script><p>ok</p>', htmlEditor = open('html', htmlRaw)
    expect(sourceTableTarget(htmlEditor, 'html', htmlRaw, { from: htmlRaw.indexOf('not a table'), to: htmlRaw.indexOf('not a table') })).toBeNull()
  })
})
