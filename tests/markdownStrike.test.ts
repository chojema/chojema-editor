import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { buildSourceMap, spliceMarkdown } from '../src/renderer/markdown/sourceSplice'
import { sourceTextSelection } from '../src/renderer/sourceCommands'

const editors: Editor[] = []
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()) })

function open(content: string) {
  const editor = new Editor({
    extensions: buildExtensions({
      slashController: { onOpen() {}, onUpdate() {}, onKeyDown: () => false, onClose() {} },
      slashItems: () => [],
    }),
    content,
    contentType: 'markdown',
  })
  editors.push(editor)
  return editor
}

describe('Markdown uses double tildes for strikethrough', () => {
  it.each([
    '2026~2927',
    '2026~2927, 2028~2929',
    '1~3, 5~7',
    '~문구~',
    '~한글 **강조** 문구~',
  ])('keeps single tildes literal: %s', raw => {
    const editor = open(raw)
    expect(editor.getHTML()).not.toContain('<s>')
    expect(editor.state.doc.textContent).toBe(raw.replaceAll('**', ''))
  })

  it('preserves intentional strikethrough and nested formatting beside ranges', () => {
    const editor = open('2026~2927, ~~취소 **강조**~~, 2028~2929')
    expect(editor.getHTML()).toBe('<p>2026~2927, <s>취소 <strong>강조</strong></s>, 2028~2929</p>')
    expect(editor.getMarkdown()).toContain('~~취소 **강조**~~')
  })

  it('keeps escaped tildes, inline code and tilde code fences literal', () => {
    const editor = open('\\~문구\\~ `~코드~ ~~코드~~`\n\n~~~text\n~코드~ ~~코드~~\n~~~')
    expect(editor.getHTML()).not.toContain('<s>')
    expect(editor.getHTML()).toContain('<code>~코드~ ~~코드~~</code>')
    expect(editor.state.doc.lastChild?.type.name).toBe('codeBlock')
    expect(editor.state.doc.lastChild?.textContent).toBe('~코드~ ~~코드~~')
  })

  it('keeps ranges literal after source reload, editing, saving and reopening', () => {
    const editor = open('initial')
    const raw = '2026~2927, 2028~2929\n\n~~취소~~\n'
    editor.commands.setContent(raw, { contentType: 'markdown', emitUpdate: false })
    const map = buildSourceMap(editor, editor.state.doc, raw)!
    expect(map).not.toBeNull()
    editor.commands.insertContentAt(editor.state.doc.firstChild!.nodeSize - 1, ' 수정')
    const saved = spliceMarkdown(editor, editor.state.doc, map)
    const reopened = open(saved)
    expect(reopened.state.doc.firstChild?.textContent).toBe('2026~2927, 2028~2929 수정')
    expect(reopened.getHTML()).toContain('<s>취소</s>')
    expect(reopened.getJSON()).toEqual(editor.getJSON())
  })

  it('maps source formatting to the intended range beside single tildes', () => {
    const raw = '2026~2927, 2028~2929'
    const editor = open(raw)
    const from = raw.indexOf('2028')
    const range = sourceTextSelection(editor, 'markdown', raw, { from, to: raw.length })!
    expect(range).not.toBeNull()
    editor.chain().setTextSelection(range).toggleBold().run()
    expect(editor.getHTML()).toBe('<p>2026~2927, <strong>2028~2929</strong></p>')
  })
})
