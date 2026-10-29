import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { CellSelection } from '@tiptap/pm/tables'
import { buildHtmlExtensions } from '../src/renderer/html/htmlExtensions'
import { cleanSerializedHtml } from '../src/renderer/html/htmlDocument'
import { BARE_ATTR } from '../src/renderer/html/preserve'
import {
  cellKeepAll,
  paragraphKeepAll,
  setBodyKeepAll,
  setCellKeepAll,
  setParagraphKeepAll,
  styleWordBreak,
  withKeepAll,
} from '../src/renderer/html/wordBreak'

let editor: Editor | null = null

function open(body: string): Editor {
  editor = new Editor({ extensions: buildHtmlExtensions(), content: body })
  return editor
}

const html = (e: Editor) => cleanSerializedHtml(e.getHTML(), BARE_ATTR)

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('word-break style helpers', () => {
  it('reads and edits the declaration', () => {
    expect(styleWordBreak('color: red; Word-Break : keep-all')).toBe('keep-all')
    expect(styleWordBreak('color: red')).toBeNull()
    expect(withKeepAll('color: red', true)).toBe('color: red; word-break: keep-all')
    expect(withKeepAll('word-break: break-all; color: red', true)).toBe('color: red; word-break: keep-all')
    expect(withKeepAll('color: red; word-break: keep-all;', false)).toBe('color: red')
  })
})

describe('setBodyKeepAll', () => {
  const head = '<!DOCTYPE html>\n<html>\n<head><title>T</title></head>\n'

  it('adds a style attribute to a bare body tag', () => {
    expect(setBodyKeepAll(`${head}<body>`, true)).toEqual({
      prefix: `${head}<body style="word-break: keep-all">`,
      style: 'word-break: keep-all',
    })
  })

  it('edits an existing style and keeps the other attributes', () => {
    const out = setBodyKeepAll(`${head}<body class="page" style='margin:0; font-family: "A B"'>`, true)
    expect(out?.prefix).toBe(`${head}<body class="page" style='margin:0; font-family: "A B"; word-break: keep-all'>`)
  })

  it('removes the style attribute when nothing else is left', () => {
    expect(setBodyKeepAll(`${head}<body id="x" style="word-break: keep-all">`, false)?.prefix).toBe(`${head}<body id="x">`)
    expect(setBodyKeepAll(`${head}<body style="margin:0;word-break:keep-all">`, false)?.prefix).toBe(
      `${head}<body style="margin:0">`,
    )
  })

  it('needs a body tag', () => {
    expect(setBodyKeepAll('', true)).toBeNull()
    expect(setBodyKeepAll('<html><head></head>', true)).toBeNull()
  })
})

describe('word-break in the html editor', () => {
  it('round-trips a declaration once, next to the other styles', () => {
    const e = open('<p style="color: red; word-break: keep-all">가나다</p><p style="word-break: break-all">x</p>')
    const out = html(e)
    expect(out.match(/word-break/g)).toHaveLength(2)
    expect(out).toContain('color: red')
    expect(out).toContain('word-break: keep-all')
    expect(out).toContain('word-break: break-all')
  })

  it('leaves word-break in the preserved style of blocks it does not cover', () => {
    expect(html(open('<blockquote style="word-break: keep-all"><p>a</p></blockquote>'))).toContain(
      '<blockquote style="word-break: keep-all;">',
    )
  })

  it('sets and clears keep-all on the selected paragraphs', () => {
    const e = open('<p>첫째</p><h2>둘째</h2><p>셋째</p>')
    e.commands.setTextSelection({ from: 2, to: 7 })
    expect(paragraphKeepAll(e.state)).toBe(false)
    setParagraphKeepAll(e, true)
    expect(paragraphKeepAll(e.state)).toBe(true)
    expect(html(e)).toBe('<p style="word-break: keep-all;">첫째</p><h2 style="word-break: keep-all;">둘째</h2><p>셋째</p>')
    setParagraphKeepAll(e, false)
    expect(html(e)).toBe('<p>첫째</p><h2>둘째</h2><p>셋째</p>')
  })

  it('carries keep-all to the paragraph Enter creates', () => {
    const e = open('<p style="word-break: keep-all">가나</p>')
    e.commands.setTextSelection(2)
    e.commands.splitBlock()
    expect(html(e)).toBe('<p style="word-break: keep-all;">가</p><p style="word-break: keep-all;">나</p>')
  })

  it('sets keep-all on the cell under the cursor or on every selected cell', () => {
    const e = open('<table><tbody><tr><td>가</td><td>나</td></tr><tr><td>다</td><td>라</td></tr></tbody></table>')
    const cells: number[] = []
    e.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableCell') cells.push(pos)
      return true
    })
    e.commands.setTextSelection(cells[0]! + 2)
    expect(cellKeepAll(e.state)).toBe(false)
    setCellKeepAll(e, true)
    expect(html(e)).toContain('<td style="word-break: keep-all;">가</td><td>나</td>')

    e.view.dispatch(e.state.tr.setSelection(CellSelection.create(e.state.doc, cells[0]!, cells[3]!)))
    expect(cellKeepAll(e.state)).toBe(false)
    setCellKeepAll(e, true)
    expect(cellKeepAll(e.state)).toBe(true)
    expect(html(e).match(/<td style="word-break: keep-all;">/g)).toHaveLength(4)
    setCellKeepAll(e, false)
    expect(html(e)).not.toContain('word-break')
  })

  it('reports no cell outside a table', () => {
    const e = open('<p>가</p>')
    expect(cellKeepAll(e.state)).toBeNull()
  })
})
