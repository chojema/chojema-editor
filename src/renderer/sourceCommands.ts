import { useCallback, useEffect } from 'react'
import { createNodeFromContent, type Editor } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { Transform } from '@tiptap/pm/transform'
import { parseHtmlDocument } from './html/htmlDocument'
import { parseDocText, stripLegacyFencedDivs } from './markdown/docText'
import { showToast } from './components/toast-bus'
import { t } from './i18n/locale'
import { OPEN_LINK_EVENT } from './editor/blockKeymap'
import type { ViewModes } from './views'

export type EditorAction = (editor: Editor) => unknown
export type RunEditorAction = (action: EditorAction) => boolean

/** Resolve source text through the SAME parser as the preview. The marked
 * document must become exactly the original after removing the sentinels;
 * otherwise the range is markup/metadata and must never hit a stale selection. */
export function sourceTextSelection(editor: Editor, kind: 'html' | 'markdown', raw: string, range: { from: number; to: number }): { from: number; to: number } | null {
  const source = raw.replace(/\r\n/g, '\n')
  if (range.from === 0 && range.to === source.length && source.length) return { from: 0, to: editor.state.doc.content.size }
  let token = '\uE000source-selection\uE001'
  while (source.includes(token)) token += '\uE002'
  const start = token + 'a', end = token + 'b'
  const tagged = source.slice(0, range.from) + start + source.slice(range.from, range.to) + end + source.slice(range.to)
  let doc = kind === 'html'
    ? createNodeFromContent(parseHtmlDocument(tagged).body, editor.schema, { slice: false }) as Node
    : editor.markdown ? editor.schema.nodeFromJSON(editor.markdown.parse(stripLegacyFencedDivs(parseDocText(tagged).body))) : null
  if (!doc) return null
  if (kind === 'html') doc = doc.type.create(editor.state.doc.attrs, doc.content, doc.marks)
  const runs: { text: string; pos: number; offset: number }[] = []
  let text = ''
  doc.descendants((node, pos) => {
    if (node.isText) { runs.push({ text: node.text!, pos, offset: text.length }); text += node.text! }
  })
  const position = (marker: string): number | null => {
    const offset = text.indexOf(marker)
    if (offset < 0) return null
    const run = runs.find(r => offset >= r.offset && offset + marker.length <= r.offset + r.text.length)
    return run ? run.pos + offset - run.offset : null
  }
  const a = position(start), b = position(end)
  if (a === null || b === null || b < a + start.length) return null
  const cleaned = new Transform(doc).delete(b, b + end.length).delete(a, a + start.length).doc
  if (!cleaned.eq(editor.state.doc)) return null
  return { from: a, to: b - start.length }
}

export function useSourceCommands(editor: Editor | null, kind: 'html' | 'markdown', views: ViewModes) {
  const prepare = useCallback(() => {
    if (!editor) return false
    views.settle()
    const source = views.sourceRef.current
    if (!source) return false
    const range = sourceTextSelection(editor, kind, source.getValue(), source.selection())
    if (!range) return false
    const doc = editor.state.doc
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.between(doc.resolve(range.from), doc.resolve(range.to))).setMeta('addToHistory', false))
    return true
  }, [editor, kind, views.settle, views.sourceRef])

  // Refresh pressed-state only after the source selection rests, not per key.
  useEffect(() => {
    if (views.activePane !== 'source') return
    const timer = window.setTimeout(prepare, 180)
    return () => window.clearTimeout(timer)
  }, [prepare, views.activePane, views.sourceSelection])

  const run = useCallback<RunEditorAction>((action) => {
    if (!editor) return false
    const inSource = views.mode === 'source' || views.lastPaneRef.current === 'source'
    if (inSource) {
      if (!prepare()) { showToast(t('sourceFormatUnavailable')); return false }
      const source = views.sourceRef.current!
      const before = source.selection()
      const selected = source.getValue().replace(/\r\n/g, '\n').slice(before.from, before.to)
      const doc = editor.state.doc, marks = editor.state.storedMarks
      action(editor)
      if (!selected && editor.state.doc.eq(doc) && editor.state.storedMarks !== marks) {
        editor.view.dispatch(editor.state.tr.setStoredMarks(marks))
        showToast(t('sourceFormatUnavailable'))
        return false
      }
      views.flushEditor(true)
      if (selected) {
        const next = source.getValue().replace(/\r\n/g, '\n')
        let nearest = -1
        for (let at = next.indexOf(selected); at >= 0; at = next.indexOf(selected, at + 1)) {
          if (nearest < 0 || Math.abs(at - before.from) < Math.abs(nearest - before.from)) nearest = at
        }
        if (nearest >= 0) source.setSelection(nearest, nearest + selected.length)
      }
      views.activate('source')
      views.sourceRef.current?.focus()
    } else {
      views.activate('visual')
      editor.commands.focus()
      action(editor)
    }
    return true
  }, [editor, prepare, views.mode, views.lastPaneRef, views.flushEditor, views.activate, views.sourceRef])

  const history = useCallback((direction: 'undo' | 'redo') => {
    if (views.mode === 'source' || views.lastPaneRef.current === 'source') views.sourceHistory(direction)
    else if (editor) { views.activate('visual'); editor.chain().focus()[direction]().run() }
  }, [editor, views.mode, views.lastPaneRef, views.sourceHistory, views.activate])
  const focus = useCallback(() => {
    if (views.mode === 'source' || views.lastPaneRef.current === 'source') views.sourceRef.current?.focus()
    else editor?.commands.focus()
  }, [editor, views.mode, views.lastPaneRef, views.sourceRef])

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.isComposing || !views.sourceRef.current?.hasFocus()) return
      const code = event.code
      if (!['KeyB', 'KeyI', 'KeyK', ...(kind === 'html' ? ['KeyU'] : [])].includes(code)) return
      event.preventDefault()
      event.stopPropagation()
      if (code === 'KeyK') {
        if (run(() => {})) window.dispatchEvent(new Event(OPEN_LINK_EVENT))
      } else run(e => {
        const chain = e.chain()
        return (code === 'KeyB' ? chain.toggleBold() : code === 'KeyI' ? chain.toggleItalic() : chain.toggleUnderline()).run()
      })
    }
    window.addEventListener('keydown', shortcut, true)
    return () => window.removeEventListener('keydown', shortcut, true)
  }, [run, kind, views.sourceRef])
  return { run, history, focus }
}
