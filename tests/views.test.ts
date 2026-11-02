import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, createElement, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EditorView } from '@codemirror/view'
import { undo } from '@codemirror/commands'
import { Panes, useViewModes, type ViewModes } from '../src/renderer/views'

let root: Root | undefined
let views: ViewModes
let documentText = 'PREVIEW\nSOURCE'
const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(async () => {
  vi.useFakeTimers()
  const prefs = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => prefs.get(key) ?? null, setItem: (key: string, value: string) => prefs.set(key, value), clear: () => prefs.clear() })
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.setItem('chojema.view.test', 'split')
  documentText = 'PREVIEW\nSOURCE'
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
  function Harness() {
    const scroll = useRef<HTMLDivElement>(null)
    views = useViewModes({ prefKey: 'test', initialSource: documentText, serialize: () => documentText, load: text => { documentText = text }, onDirty() {}, onStats() {} })
    return createElement(Panes, { views, prefKey: 'test', language: 'text', wrap: true, zoom: 100, completion: false, visualScrollRef: scroll,
      children: createElement('div', { id: 'visual-test', tabIndex: 0 }) })
  }
  const host = document.createElement('div'); document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(createElement(Harness)))
})
afterEach(async () => {
  await act(async () => root?.unmount())
  document.body.replaceChildren()
  localStorage.clear()
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()
  actGlobal.IS_REACT_ACT_ENVIRONMENT = false
})
const pointer = (pane: string) => document.querySelector(pane)!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
const sourceView = () => EditorView.findFromDOM(document.querySelector('.cm-content')!)!

it('retains both edits when switching source to preview before the debounce expires', async () => {
  await act(async () => {
    pointer('.pane-source')
    const code = sourceView(); code.dispatch({ changes: { from: code.state.doc.length, insert: '!' } })
    pointer('#visual-test')
    documentText = documentText.replace('PREVIEW', 'PREVIEW?'); views.onEditorUpdate()
    vi.advanceTimersByTime(400)
  })
  expect(documentText).toBe('PREVIEW?\nSOURCE!')
  expect(views.getContent()).toBe(documentText)
})
it('retains both edits when switching preview to source before the debounce expires', async () => {
  await act(async () => {
    pointer('#visual-test'); documentText = 'PREVIEW?\nSOURCE'; views.onEditorUpdate()
    pointer('.pane-source')
    const code = sourceView(); code.dispatch({ changes: { from: code.state.doc.length, insert: '!' } })
    vi.advanceTimersByTime(400)
  })
  expect(documentText).toBe('PREVIEW?\nSOURCE!')
  expect(views.getContent()).toBe(documentText)
})
it('makes a save snapshot and both panes agree even before timers run', async () => {
  await act(async () => {
    pointer('.pane-source')
    const code = sourceView(); code.dispatch({ changes: { from: code.state.doc.length, insert: '!' } })
    pointer('#visual-test'); documentText += '?'; views.onEditorUpdate()
    const saved = views.getContent()
    expect(saved).toBe('PREVIEW\nSOURCE!?')
    expect(documentText).toBe(saved)
    vi.advanceTimersByTime(400)
    expect(views.getContent()).toBe(saved)
  })
})
it('does not put initial loading or preview synchronization on the source undo stack', async () => {
  await act(async () => {
    views.sourceRef.current!.setValue('loaded file')
    expect(undo(sourceView())).toBe(false)
    const code = sourceView(); code.dispatch({ changes: { from: code.state.doc.length, insert: '!' } })
    expect(undo(code)).toBe(true)
    expect(code.state.doc.toString()).toBe('loaded file')
  })
})
