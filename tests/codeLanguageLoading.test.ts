import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, createElement, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EditorView } from '@codemirror/view'
import { undo, undoDepth } from '@codemirror/commands'
import { syntaxTree } from '@codemirror/language'
import { markdown } from '@codemirror/lang-markdown'
import { CodeEditor, type CodeEditorHandle } from '../src/renderer/text/CodeEditor'

const control = vi.hoisted(() => ({
  ready: false,
  complete: undefined as (() => void) | undefined,
  fail: undefined as ((reason: unknown) => void) | undefined,
}))
vi.mock('../src/renderer/text/languages', () => ({
  loadedLanguage: () => control.ready ? markdown() : [],
  loadLanguage: () => new Promise<void>((resolve, reject) => {
    control.complete = () => { control.ready = true; resolve() }
    control.fail = reject
  }),
}))
const toast = vi.hoisted(() => vi.fn())
vi.mock('../src/renderer/components/toast-bus', () => ({ showToast: toast }))

let root: Root | undefined
const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true
  control.ready = false; control.complete = undefined; control.fail = undefined
  toast.mockClear()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
})
afterEach(async () => {
  await act(async () => root?.unmount()); root = undefined
  document.body.replaceChildren()
  vi.restoreAllMocks(); vi.unstubAllGlobals()
  actGlobal.IS_REACT_ACT_ENVIRONMENT = false
})
async function mount() {
  const ref = createRef<CodeEditorHandle>()
  const onChange = vi.fn()
  const host = document.createElement('div'); document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(createElement(CodeEditor, {
    ref, initialValue: '# 원문\r\n', language: 'markdown', wrap: true, onChange,
  })))
  const view = EditorView.findFromDOM(document.querySelector('.cm-content')!)!
  return { ref, onChange, view }
}

it('adds late grammar support without replacing the editor, content, selection, or undo history', async () => {
  const { ref, view, onChange } = await mount()
  await act(async () => view.dispatch({ changes: { from: view.state.doc.length, insert: '본문' }, selection: { anchor: 2 } }))
  const content = ref.current!.getValue()
  const selection = view.state.selection.main.from
  const history = undoDepth(view.state)
  await act(async () => control.complete!())
  expect(EditorView.findFromDOM(document.querySelector('.cm-content')!)).toBe(view)
  expect(ref.current!.getValue()).toBe(content)
  expect(view.state.selection.main.from).toBe(selection)
  expect(undoDepth(view.state)).toBe(history)
  expect(syntaxTree(view.state).toString()).toContain('ATXHeading1')
  expect(onChange).toHaveBeenCalledTimes(1)
  await act(async () => { undo(view) })
  expect(ref.current!.getValue()).toBe('# 원문\r\n')
})

it('keeps editing available after a grammar failure and reports the failure', async () => {
  const { ref, view, onChange } = await mount()
  await act(async () => control.fail!(new Error('offline')))
  expect(toast).toHaveBeenCalledWith(expect.any(String), 'error')
  await act(async () => view.dispatch({ changes: { from: view.state.doc.length, insert: '계속 편집' } }))
  expect(ref.current!.getValue()).toBe('# 원문\r\n계속 편집')
  expect(onChange).toHaveBeenCalledTimes(1)
})

it('ignores a grammar result arriving after its editor has unmounted', async () => {
  const { onChange } = await mount()
  await act(async () => root!.unmount()); root = undefined
  await act(async () => control.complete!())
  expect(document.querySelector('.cm-editor')).toBeNull()
  expect(onChange).not.toHaveBeenCalled()
  expect(toast).not.toHaveBeenCalled()
})
