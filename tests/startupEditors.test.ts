import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EditorView } from '@codemirror/view'
import { undo, undoDepth } from '@codemirror/commands'
import type { DocKind, EditorApi, InitialDoc, MenuCommand } from '../src/shared/ipc'
import { App } from '../src/renderer/App'

const control = vi.hoisted(() => ({ failures: 0, requested: [] as string[] }))
vi.mock('../src/renderer/editorModules', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/renderer/editorModules')>()
  return {
    ...actual,
    loadSurface: (kind: Parameters<typeof actual.loadSurface>[0]) => {
      control.requested.push(kind)
      if (control.failures-- > 0) return Promise.reject(new Error('temporary import failure'))
      return actual.loadSurface(kind)
    },
  }
})

let root: Root | undefined
let initial: InitialDoc
let menu: Set<(command: MenuCommand) => void>
let save: ReturnType<typeof vi.fn>
let dirty: ReturnType<typeof vi.fn>
const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const view = () => EditorView.findFromDOM(document.querySelector('.cm-content')!)!

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true
  control.failures = 0; control.requested = []
  const prefs = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => prefs.get(key) ?? null, setItem: (key: string, value: string) => prefs.set(key, value) })
  for (const kind of ['markdown', 'html', 'json', 'svg']) localStorage.setItem(`chojema.view.${kind}`, 'source')
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
  vi.stubGlobal('requestIdleCallback', undefined)
  initial = { path: null, kind: 'text', content: '', encoding: 'UTF-8', language: 'ko', autoCopy: false, autoComplete: true }
  menu = new Set()
  save = vi.fn(async () => ({ ok: true }))
  dirty = vi.fn()
  const noop = () => () => {}
  window.editorApi = {
    getInitialDoc: async () => initial,
    onLanguageChanged: noop, onAutoCopyChanged: noop, onAutoCompleteChanged: noop,
    onSaveBeforeClose: noop,
    onMenuCommand: (handler: (command: MenuCommand) => void) => { menu.add(handler); return () => { menu.delete(handler) } },
    setDirty: dirty, save, saveAs: save,
  } as unknown as EditorApi
})
afterEach(async () => {
  await act(async () => root?.unmount()); root = undefined
  document.body.replaceChildren()
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()
  actGlobal.IS_REACT_ACT_ENVIRONMENT = false
})

async function mount(kind: DocKind = 'text', content = '') {
  initial = { ...initial, kind, content }
  const host = document.createElement('div'); document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(createElement(App)))
}
async function waitForEditor() {
  await act(async () => {
    await vi.waitFor(() => expect(document.querySelector('.cm-content')).not.toBeNull(), { timeout: 10000 })
  })
}

it('starts text without requesting another editor and preserves typing/history across all warmups', async () => {
  await mount('text', '원문\r\n')
  expect(control.requested).toEqual([])
  const original = view()
  await act(async () => original.dispatch({ changes: { from: original.state.doc.length, insert: '입력' } }))
  const content = original.state.doc.toString()
  const history = undoDepth(original.state)
  // Exercise the actual cached warmers; scheduler timing is tested separately.
  const { editorWarmups } = await import('../src/renderer/editorModules')
  await act(async () => { for (const warm of editorWarmups) await warm() })
  expect(view()).toBe(original)
  expect(view().state.doc.toString()).toBe(content)
  expect(undoDepth(view().state)).toBe(history)
  await act(async () => { for (const callback of menu) callback('save') })
  expect(save).toHaveBeenCalledWith('원문\r\n입력', 'text')
  await act(async () => { undo(original) })
  expect(original.state.doc.toString()).toBe('원문\n')
})

it.each([
  ['markdown', '# 원문\n\n본문\n'],
  ['html', '<!doctype html>\n<html><body><p>원문</p></body></html>'],
  ['json', '{ "원문": 1e2 }\n'],
  ['svg', '<svg xmlns="http://www.w3.org/2000/svg"><title>원문</title></svg>'],
] as const)('opens requested %s immediately and saves its untouched source exactly', async (kind, content) => {
  await mount(kind, content)
  await waitForEditor()
  expect(control.requested[0]).toBe(kind)
  expect(dirty).not.toHaveBeenCalledWith(true)
  await act(async () => { for (const callback of menu) callback('save') })
  expect(save).toHaveBeenCalledWith(content, kind)
})

it('offers retry after a module failure and keeps the original document', async () => {
  control.failures = 1
  const content = '{"원문":1}\n'
  await mount('json', content)
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('편집기를 불러오지 못했습니다')
  const retry = document.querySelector<HTMLButtonElement>('[role="alert"] button')!
  expect(retry.textContent).toBe('다시 시도')
  await act(async () => retry.click())
  await waitForEditor()
  expect(view().state.doc.toString()).toBe(content)
  expect(control.requested).toEqual(['json', 'json'])
  expect(dirty).not.toHaveBeenCalledWith(true)
})
