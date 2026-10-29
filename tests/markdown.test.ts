import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { parseDocText } from '../src/renderer/markdown/docText'
import { captureMarkdownSource, serializeMarkdown } from '../src/renderer/markdown/roundtripSerializer'
import { buildSourceMap, spliceMarkdown } from '../src/renderer/markdown/sourceSplice'

let editor: Editor | null = null

afterEach(() => {
  editor?.destroy()
  editor = null
})

/** the same load → serialize path MarkdownSurface uses */
function open(raw: string) {
  const ed = new Editor({
    extensions: buildExtensions({
      slashController: { onOpen() {}, onUpdate() {}, onKeyDown: () => false, onClose() {} },
      slashItems: () => [],
    }),
  })
  editor = ed
  const envelope = parseDocText(raw)
  ed.commands.setContent(envelope.body, { contentType: 'markdown', emitUpdate: false })
  const map = buildSourceMap(ed, ed.state.doc, envelope.body)
  const original = captureMarkdownSource(raw, envelope, ed.state.doc)
  const save = () =>
    serializeMarkdown(
      envelope,
      ed.state.doc,
      () => (map ? spliceMarkdown(ed, ed.state.doc, map) : ed.getMarkdown()),
      original,
    )
  return { ed, save }
}

const SAMPLE = `---
title: Sample
tags: [a, b]
---

# Heading

Some *emphasis* and __strong__ text.

* item one
* item two

| a | b |
|---|:-:|
| 1 | 2 |

\`\`\`js
const x = 1
\`\`\`

Last paragraph.
`

const TASKS = `# T

Intro.

- [ ] todo
- [x] done
`

describe('markdown round trip', () => {
  it('does not add blank lines when the block before a task list is edited', () => {
    const { ed, save } = open(TASKS)
    let end = -1
    ed.state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && node.textContent === 'Intro.') end = pos + node.nodeSize - 1
    })
    ed.chain().setTextSelection(end).insertContent(' X').run()
    expect(save()).toBe(TASKS.replace('Intro.', 'Intro. X'))
  })

  it('writes an untouched file back byte for byte', () => {
    const { save } = open(SAMPLE)
    expect(save()).toBe(SAMPLE)
  })

  it('re-serializes only the edited block and keeps the others as written', () => {
    const { ed, save } = open(SAMPLE)
    let lastPos = -1
    ed.state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && node.textContent === 'Last paragraph.') lastPos = pos
    })
    expect(lastPos).toBeGreaterThan(0)
    ed.chain().setTextSelection(lastPos + 1 + 'Last paragraph'.length).insertContent(' edited').run()
    const out = save()
    expect(out).toContain('Last paragraph edited.')
    // untouched blocks keep their original markers (`*`, `__`, `* item`, table alignment)
    expect(out).toContain('Some *emphasis* and __strong__ text.')
    expect(out).toContain('* item one')
    expect(out).toContain('|---|:-:|')
    expect(out.startsWith('---\ntitle: Sample\ntags: [a, b]\n---\n')).toBe(true)
  })
})
