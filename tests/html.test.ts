import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildHtmlExtensions } from '../src/renderer/html/htmlExtensions'
import { formatHtml, parseHtmlDocument, serializeHtmlDocument } from '../src/renderer/html/htmlDocument'
import { scopeSelector } from '../src/renderer/html/scopeCss'

let editor: Editor | null = null

function roundTrip(body: string): string {
  editor = new Editor({ extensions: buildHtmlExtensions(), content: body })
  return editor.getHTML()
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('html envelope', () => {
  const doc = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <title>Test</title>
  <style>body { color: red; }</style>
</head>
<body class="page" style="margin:0">
<p>Hello</p>
</body>
</html>
`

  it('keeps everything outside <body> verbatim', () => {
    const env = parseHtmlDocument(doc)
    expect(env.prefix).toContain('<title>Test</title>')
    expect(env.prefix.endsWith('<body class="page" style="margin:0">')).toBe(true)
    expect(env.suffix.startsWith('</body>')).toBe(true)
    expect(env.bodyAttrs).toEqual({ class: 'page', style: 'margin:0' })
    const out = serializeHtmlDocument(env, '<p>Changed</p>')
    expect(out).toContain('<title>Test</title>')
    expect(out).toContain('<p>Changed</p>')
    expect(out.endsWith('</html>\n')).toBe(true)
  })

  it('keeps CRLF line endings and the BOM', () => {
    const env = parseHtmlDocument(`﻿${doc.replace(/\n/g, '\r\n')}`)
    const out = serializeHtmlDocument(env, '<p>x</p>')
    expect(out.startsWith('﻿')).toBe(true)
    expect(out.includes('\n') && !/[^\r]\n/.test(out)).toBe(true)
  })

  it('treats a file without <body> as a fragment', () => {
    const env = parseHtmlDocument('<h1>T</h1><p>a</p>')
    expect(env.prefix).toBe('')
    expect(serializeHtmlDocument(env, '<h1>T</h1><p>a</p>')).toBe('<h1>T</h1>\n<p>a</p>\n')
  })
})

describe('formatHtml', () => {
  it('puts blocks on their own lines and leaves <pre> alone', () => {
    const out = formatHtml('<h1>A</h1><ul><li><p>x</p></li></ul><pre><code>a\n  b</code></pre><p>z</p>')
    expect(out).toBe('<h1>A</h1>\n<ul>\n<li><p>x</p>\n</li>\n</ul>\n<pre><code>a\n  b</code></pre>\n<p>z</p>')
  })
})

describe('html visual editor preserves markup', () => {
  it('keeps classes, ids, inline styles and data attributes on blocks', () => {
    const out = roundTrip('<p class="lead" id="intro" data-x="1" style="color: blue">Hi</p>')
    expect(out).toContain('class="lead"')
    expect(out).toContain('id="intro"')
    expect(out).toContain('data-x="1"')
    expect(out).toContain('color: blue')
  })

  it('keeps layout containers without wrapping their text in <p>', () => {
    const out = roundTrip('<div class="card"><div class="title">Title</div><p>Body</p></div>')
    expect(out).toContain('<div class="card">')
    expect(out).toContain('<div class="title">Title</div>')
    expect(out).toContain('<p>Body</p>')
  })

  it('keeps sections, headers and figures', () => {
    const out = roundTrip('<section id="s"><header><h2>H</h2></header><p>t</p></section>')
    expect(out).toContain('<section id="s">')
    expect(out).toContain('<header>')
  })

  it('keeps text styling: color, font, size, background, alignment', () => {
    const out = roundTrip(
      '<p style="text-align: center"><span style="color: rgb(255, 0, 0); font-size: 20px">red</span> <u>u</u> <sub>2</sub> <sup>3</sup> <mark>m</mark></p>',
    )
    expect(out).toContain('text-align: center')
    expect(out).toContain('color: rgb(255, 0, 0)')
    expect(out).toContain('font-size: 20px')
    expect(out).toContain('<u>u</u>')
    expect(out).toContain('<sub>2</sub>')
    expect(out).toContain('<sup>3</sup>')
    expect(out).toContain('<mark>m</mark>')
  })

  it('keeps spans that carry a class and inline elements with no mark of their own', () => {
    const out = roundTrip('<p><span class="tag">k</span> <abbr title="HyperText">HTML</abbr> <kbd>⌘S</kbd></p>')
    expect(out).toContain('<span class="tag">k</span>')
    expect(out).toContain('<abbr title="HyperText">HTML</abbr>')
    expect(out).toContain('<kbd>⌘S</kbd>')
  })

  it('keeps scripts, iframes and forms verbatim as preserved blocks', () => {
    const script = '<script>console.log("x < y")</script>'
    const iframe = '<iframe src="https://example.com" width="300"></iframe>'
    const form = '<form action="/go"><input name="q"><button>Go</button></form>'
    const out = roundTrip(`<p>a</p>${script}${iframe}${form}<p>b</p>`)
    expect(out).toContain(script)
    expect(out).toContain(iframe)
    expect(out).toContain('<form action="/go"><input name="q"><button>Go</button></form>')
  })

  it('keeps an inline svg inside a paragraph', () => {
    const out = roundTrip('<p>icon <svg width="10" height="10"><circle r="4" cx="5" cy="5"></circle></svg> text</p>')
    expect(out).toMatch(/<p>icon <svg[^>]*width="10"[^>]*>.*<\/svg> text<\/p>/)
  })

  it('keeps tables with cell spans and attributes', () => {
    const out = roundTrip(
      '<table class="grid"><tbody><tr><th colspan="2">H</th></tr><tr><td class="c">1</td><td>2</td></tr></tbody></table>',
    )
    expect(out).toContain('class="grid"')
    expect(out).toContain('colspan="2"')
    expect(out).toContain('class="c"')
  })

  it('keeps image size and links', () => {
    const out = roundTrip(
      '<p><a href="https://x.dev" class="btn">go</a> <img src="https://x.dev/a.png" alt="a" width="120"></p>',
    )
    expect(out).toContain('href="https://x.dev"')
    expect(out).toContain('class="btn"')
    expect(out).toContain('width="120"')
    expect(out).toContain('src="https://x.dev/a.png"')
  })
})

describe('bare text in cells and list items', () => {
  it('saves <td>1</td> and <li>x</li> without an added <p>', async () => {
    const { cleanSerializedHtml } = await import('../src/renderer/html/htmlDocument')
    const { BARE_ATTR } = await import('../src/renderer/html/preserve')
    const html = roundTrip(
      '<ul><li>x</li><li><p>y</p><p>z</p></li></ul><table class="grid"><tbody><tr><th>H</th><td colspan="2">1</td></tr></tbody></table>',
    )
    const out = cleanSerializedHtml(html, BARE_ATTR)
    expect(out).toContain('<li>x</li>')
    expect(out).toContain('<li><p>y</p><p>z</p></li>')
    expect(out).toContain('<table class="grid"><tbody><tr><th>H</th><td colspan="2">1</td></tr></tbody></table>')
    expect(out).not.toContain(BARE_ATTR)
  })
})

describe('scopeSelector', () => {
  const S = '.html-canvas'
  it.each([
    ['p', `${S} p`],
    ['body', S],
    ['html', S],
    [':root', S],
    ['html body p', `${S} p`],
    ['body > p', `${S} > p`],
    ['body.dark p', `${S}.dark p`],
    ['.card h2', `${S} .card h2`],
  ])('%s → %s', (input, expected) => {
    expect(scopeSelector(input, S)).toBe(expected)
  })
})
