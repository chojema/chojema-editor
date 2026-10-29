import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildHtmlExtensions } from '../src/renderer/html/htmlExtensions'
import { linkTargetAttrs, opensInNewWindow } from '../src/renderer/html/linkTarget'

let editor: Editor | null = null

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('linkTargetAttrs', () => {
  it('adds target and rel for a new window', () => {
    expect(linkTargetAttrs({}, true)).toEqual({ target: '_blank', rel: 'noopener noreferrer' })
  })

  it('removes them for the current window', () => {
    expect(linkTargetAttrs({ target: '_blank', rel: 'noopener noreferrer' }, false)).toEqual({ target: null, rel: null })
  })

  it('keeps other rel tokens', () => {
    expect(linkTargetAttrs({ rel: 'nofollow' }, true)).toEqual({ target: '_blank', rel: 'nofollow noopener noreferrer' })
    expect(linkTargetAttrs({ target: '_blank', rel: 'nofollow noopener' }, false)).toEqual({ target: null, rel: 'nofollow' })
  })

  it('leaves the attributes as written when the choice is unchanged', () => {
    expect(linkTargetAttrs({ target: '_blank' }, true)).toEqual({ target: '_blank', rel: null })
    expect(linkTargetAttrs({ target: '_top', rel: 'external' }, false)).toEqual({ target: '_top', rel: 'external' })
  })

  it('treats only _blank as a new window', () => {
    expect(opensInNewWindow('_blank')).toBe(true)
    expect(opensInNewWindow('_self')).toBe(false)
    expect(opensInNewWindow(null)).toBe(false)
  })
})

describe('html link target in the editor', () => {
  const linkWith = (body: string, newWindow: boolean) => {
    editor = new Editor({ extensions: buildHtmlExtensions(), content: body })
    editor.commands.setTextSelection(2)
    const attrs = linkTargetAttrs(editor.getAttributes('link'), newWindow)
    editor.chain().extendMarkRange('link').setLink({ href: 'https://example.com', ...attrs }).run()
    return editor.getHTML()
  }

  it('writes target="_blank" with rel', () => {
    const out = linkWith('<p><a href="https://example.com">site</a></p>', true)
    expect(out).toContain('target="_blank"')
    expect(out).toContain('rel="noopener noreferrer"')
  })

  it('drops target and rel when switched off', () => {
    const out = linkWith('<p><a href="https://example.com" target="_blank" rel="noopener noreferrer">site</a></p>', false)
    expect(out).not.toContain('target=')
    expect(out).not.toContain('rel=')
  })

  it('creates plain links by default', () => {
    editor = new Editor({ extensions: buildHtmlExtensions(), content: '<p>site</p>' })
    editor.chain().setTextSelection({ from: 1, to: 5 }).setLink({ href: 'https://example.com' }).run()
    expect(editor.getHTML()).toBe('<p><a href="https://example.com">site</a></p>')
  })
})
