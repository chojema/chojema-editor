import { afterEach, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { FindBar } from '../src/renderer/components/FindBar'
import { buildHtmlExtensions } from '../src/renderer/html/htmlExtensions'

let root: Root | undefined
let editor: Editor | undefined
const oldScroll = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const oldActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  editor?.destroy()
  editor = undefined
  document.body.replaceChildren()
  if (oldScroll) Object.defineProperty(Element.prototype, 'scrollIntoView', oldScroll)
  else Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = oldActEnvironment
})

it('reveals the active hit while find input and navigation buttons keep focus', async () => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  const scrolled: Element[] = []
  const scroll = vi.fn(function (this: Element) { scrolled.push(this) })
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scroll })
  const host = document.createElement('div')
  const content = document.createElement('div')
  document.body.append(host, content)
  editor = new Editor({ element: content, extensions: buildHtmlExtensions(), content: '<p>target one</p><p>target two</p><p>target three</p>' })
  const original = editor.getHTML()
  root = createRoot(host)
  await act(async () => root!.render(createElement(FindBar, { editor: editor!, withReplace: false, onClose() {} })))
  const input = host.querySelector<HTMLInputElement>('.find-input')!
  const buttons = [...host.querySelectorAll<HTMLButtonElement>('button')]
  const next = buttons.find((button) => button.textContent === '↓')!
  const prev = buttons.find((button) => button.textContent === '↑')!
  const type = async (value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const assertHit = (index: number, focus: HTMLElement) => {
    const hits = [...content.querySelectorAll('.search-hit')]
    expect(hits[index]).toBe(content.querySelector('.search-hit-active'))
    expect(scrolled.at(-1)).toBe(hits[index])
    expect(scroll).toHaveBeenLastCalledWith({ block: 'center', inline: 'nearest' })
    expect(document.activeElement).toBe(focus)
    expect(editor!.state.doc.textBetween(editor!.state.selection.from, editor!.state.selection.to)).toBe('target')
  }
  await type('target')
  assertHit(0, input)
  for (const index of [1, 2, 0]) {
    next.focus()
    await act(async () => next.click())
    assertHit(index, next)
  }
  prev.focus()
  await act(async () => prev.click())
  assertHit(2, prev)
  input.focus()
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  assertHit(0, input)
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })))
  assertHit(2, input)
  const count = scroll.mock.calls.length
  await type('absent')
  await act(async () => next.click())
  expect(scroll).toHaveBeenCalledTimes(count)
  expect(content.querySelector('.search-hit')).toBeNull()
  expect(editor.getHTML()).toBe(original)
})
