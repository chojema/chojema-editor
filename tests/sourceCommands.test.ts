import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildHtmlExtensions } from '../src/renderer/html/htmlExtensions'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { sourceTextSelection } from '../src/renderer/sourceCommands'

let editor: Editor | undefined
afterEach(() => { editor?.destroy(); editor = undefined })

for (const kind of ['html', 'markdown'] as const) describe(`${kind} source command selection`, () => {
  const open = (source: string) => {
    editor = new Editor({ extensions: kind === 'html' ? buildHtmlExtensions() : buildExtensions({
      slashController: { onOpen() {}, onUpdate() {}, onKeyDown: () => false, onClose() {} }, slashItems: () => [],
    }) })
    editor.commands.setContent(source, { contentType: kind, emitUpdate: false })
    return editor
  }
  it('formats the selected occurrence, not the previous preview selection', () => {
    const raw = kind === 'html' ? '<p>duplicate</p><p>duplicate</p>' : 'duplicate\n\nduplicate\n'
    const ed = open(raw)
    ed.commands.setTextSelection({ from: 1, to: 10 })
    const from = raw.lastIndexOf('duplicate')
    const range = sourceTextSelection(ed, kind, raw, { from, to: from + 9 })!
    expect(range).not.toBeNull()
    ed.chain().setTextSelection(range).toggleBold().run()
    expect(ed.getHTML()).toBe('<p>duplicate</p><p><strong>duplicate</strong></p>')
  })
  it('maps a caret without changing the document or its undo history', () => {
    const raw = kind === 'html' ? '<p>alpha target omega</p>' : 'alpha target omega'
    const ed = open(raw), before = ed.getJSON(), from = raw.indexOf('target')
    expect(sourceTextSelection(ed, kind, raw, { from, to: from })).toEqual({ from: 7, to: 7 })
    expect(ed.getJSON()).toEqual(before)
  })
})

it('rejects HTML attribute ranges instead of editing another paragraph', () => {
  const raw = '<p title="target">body</p>'
  editor = new Editor({ extensions: buildHtmlExtensions(), content: raw })
  const from = raw.indexOf('target')
  expect(sourceTextSelection(editor, 'html', raw, { from, to: from + 6 })).toBeNull()
  expect(editor.getHTML()).toBe(raw)
})

it('preserves HTML table cell and inline mark positions', () => {
  const raw = '<table><tr><td>first</td><td><em>target</em></td></tr></table>'
  editor = new Editor({ extensions: buildHtmlExtensions(), content: raw })
  const from = raw.indexOf('target'), range = sourceTextSelection(editor, 'html', raw, { from, to: from + 6 })!
  expect(range).not.toBeNull()
  editor.chain().setTextSelection(range).toggleBold().run()
  expect(editor.getHTML()).toContain('<strong><em>target</em></strong>')
})

it('undoes HTML envelope changes without changing body content or exporting metadata', () => {
  editor = new Editor({ extensions: buildHtmlExtensions(), content: '<p>body</p>' })
  editor.view.dispatch(editor.state.tr.setDocAttribute('htmlPrefix', '<html><body>').setMeta('addToHistory', false))
  editor.view.dispatch(editor.state.tr.setDocAttribute('htmlPrefix', '<html><body style="word-break: keep-all">'))
  expect(editor.getHTML()).toBe('<p>body</p>')
  expect(editor.commands.undo()).toBe(true)
  expect(editor.state.doc.attrs.htmlPrefix).toBe('<html><body>')
  expect(editor.commands.redo()).toBe(true)
  expect(editor.state.doc.attrs.htmlPrefix).toContain('keep-all')
})
