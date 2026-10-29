import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { decodeText, lineEnding } from '../src/shared/encoding'
import { findRanges, replaceRanges } from '../src/renderer/components/FindBar'
import { buildHtmlExtensions } from '../src/renderer/html/htmlExtensions'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { buildFrontmatterRaw, frontmatterInner, parseDocText } from '../src/renderer/markdown/docText'
import { captureMarkdownSource, serializeMarkdown } from '../src/renderer/markdown/roundtripSerializer'
import { buildSourceMap, spliceMarkdown } from '../src/renderer/markdown/sourceSplice'

let editor: Editor | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('decodeText', () => {
  it('reads plain UTF-8 and keeps a UTF-8 BOM in the text', () => {
    expect(decodeText(new TextEncoder().encode('한글'))).toEqual({ text: '한글', encoding: 'UTF-8' })
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('a')])
    expect(decodeText(withBom)).toEqual({ text: '﻿a', encoding: 'UTF-8' })
  })

  it('reads legacy Korean (EUC-KR) bytes', () => {
    // "한글" in EUC-KR / CP949
    expect(decodeText(new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb]))).toEqual({ text: '한글', encoding: 'EUC-KR' })
  })

  it('reads UTF-16 with a byte-order mark', () => {
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x5c, 0xd5]))).toEqual({ text: '한', encoding: 'UTF-16LE' })
    expect(decodeText(new Uint8Array([0xfe, 0xff, 0xd5, 0x5c]))).toEqual({ text: '한', encoding: 'UTF-16BE' })
  })

  it('reports line endings', () => {
    expect(lineEnding('a\r\nb')).toBe('CRLF')
    expect(lineEnding('a\nb')).toBe('LF')
  })
})

describe('find and replace', () => {
  it('finds case-insensitively by default and replaces all in one step', () => {
    editor = new Editor({ extensions: buildHtmlExtensions(), content: '<p>Cat cat <b>CAT</b></p><p>dog</p>' })
    const ranges = findRanges(editor.state.doc, 'cat', false)
    expect(ranges).toHaveLength(3)
    expect(findRanges(editor.state.doc, 'cat', true)).toHaveLength(1)
    replaceRanges(editor, ranges, 'bird')
    expect(editor.getText()).toBe('bird bird bird\n\ndog')
    // the bold mark on the third hit survives the replacement
    expect(editor.getHTML()).toContain('<strong>bird</strong>')
    editor.commands.undo()
    expect(editor.getText()).toBe('Cat cat CAT\n\ndog')
  })
})

describe('frontmatter editing', () => {
  it('rewrites only the frontmatter and keeps the body as written', () => {
    const raw = '---\ntitle: A\n---\n\n# T\n\nSome *text*.\n'
    editor = new Editor({
      extensions: buildExtensions({
        slashController: { onOpen() {}, onUpdate() {}, onKeyDown: () => false, onClose() {} },
        slashItems: () => [],
      }),
    })
    const envelope = parseDocText(raw)
    editor.commands.setContent(envelope.body, { contentType: 'markdown', emitUpdate: false })
    const map = buildSourceMap(editor, editor.state.doc, envelope.body)!
    const original = captureMarkdownSource(raw, envelope, editor.state.doc)
    expect(frontmatterInner(envelope.frontmatter)).toBe('title: A')
    const edited = { ...envelope, frontmatter: buildFrontmatterRaw('title: B\ntags: [x]') }
    const out = serializeMarkdown(edited, editor.state.doc, () => spliceMarkdown(editor!, editor!.state.doc, map), original)
    expect(out).toBe('---\ntitle: B\ntags: [x]\n---\n\n# T\n\nSome *text*.\n')
  })
})
