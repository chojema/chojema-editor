import type { Editor } from '@tiptap/core'

/**
 * Turn the rendered Markdown canvas into a standalone page: editor chrome is
 * stripped, rendered diagrams replace their source, and local images are
 * embedded so the file can be moved or mailed on its own.
 */

/** editor-only elements that must not reach an exported page */
const CHROME = [
  '.md-block-gutter',
  '.md-block-menu',
  '.md-codeblock-bar',
  '.md-diagram-error',
  '.ProseMirror-gapcursor',
  '.ProseMirror-separator',
  'img.ProseMirror-separator',
  'br.ProseMirror-trailingBreak',
]

const EDITOR_ATTRS = ['contenteditable', 'draggable', 'spellcheck', 'tabindex', 'data-placeholder', 'translate']

async function inlineImage(img: HTMLImageElement): Promise<void> {
  const src = img.getAttribute('src') ?? ''
  if (!src.startsWith('md-asset://')) return
  try {
    const blob = await (await fetch(src)).blob()
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
    img.setAttribute('src', dataUrl)
  } catch {
    // a missing file stays a broken image, as it is in the editor
  }
}

/** the rendered document body (no <html> wrapper), ready to embed or copy */
export async function renderedMarkdownBody(editor: Editor): Promise<string> {
  const root = editor.view.dom.cloneNode(true) as HTMLElement
  for (const el of Array.from(root.querySelectorAll(CHROME.join(',')))) el.remove()
  // a rendered diagram shows its picture; the fenced source stays in the .md file
  for (const block of Array.from(root.querySelectorAll('[data-diagram="rendered"]'))) {
    block.querySelector('pre')?.remove()
  }
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    for (const name of EDITOR_ATTRS) el.removeAttribute(name)
    el.classList.remove('ProseMirror-selectednode', 'search-hit', 'search-hit-active', 'is-empty', 'is-editor-empty')
    if (el.getAttribute('class') === '') el.removeAttribute('class')
  }
  await Promise.all(Array.from(root.querySelectorAll('img')).map(inlineImage))
  return root.innerHTML
}

const KATEX_CSS = 'https://cdn.jsdelivr.net/npm/katex@0.18.10/dist/katex.min.css'

const PAGE_CSS = `
:root { color-scheme: light; }
body { margin: 0; background: #fff; color: #1f2328; }
.markdown-body {
  box-sizing: border-box; max-width: 820px; margin: 0 auto; padding: 40px 32px 64px;
  font: 16px/1.75 -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', 'Segoe UI', sans-serif;
  word-wrap: break-word;
}
.markdown-body > :first-child { margin-top: 0; }
h1, h2, h3, h4, h5, h6 { line-height: 1.3; margin: 1.4em 0 .5em; font-weight: 650; }
h1 { font-size: 2em; padding-bottom: .25em; border-bottom: 1px solid #d8dee4; }
h2 { font-size: 1.5em; } h3 { font-size: 1.25em; } h4 { font-size: 1.1em; }
p { margin: .6em 0; }
a { color: #0a69da; }
ul, ol { padding-left: 1.6em; margin: .6em 0; }
li > p { margin: .15em 0; }
ul[data-type="taskList"] { list-style: none; padding-left: .3em; }
ul[data-type="taskList"] li { display: flex; gap: .5em; align-items: baseline; }
ul[data-type="taskList"] li > div { flex: 1; }
ul[data-type="taskList"] li[data-checked="true"] > div { color: #6e7781; text-decoration: line-through; }
blockquote { margin: .8em 0; padding: .1em 1em; border-left: 3px solid #d0d7de; color: #57606a; }
code { font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: .875em; background: rgba(129,139,152,.14); border-radius: 4px; padding: .15em .35em; }
pre { background: #f6f8fa; border: 1px solid #d8dee4; border-radius: 8px; padding: 12px 16px; overflow-x: auto; margin: .8em 0; }
pre code { background: none; padding: 0; font-size: .85em; line-height: 1.6; }
hr { border: none; border-top: 2px solid #d8dee4; margin: 1.6em 0; }
table { border-collapse: collapse; margin: .8em 0; display: block; overflow-x: auto; }
th, td { border: 1px solid #d0d7de; padding: 6px 12px; }
th { background: #f6f8fa; font-weight: 600; }
td > p, th > p { margin: 0; }
img { max-width: 100%; }
mark { background: #fff3a3; padding: 0 .1em; }
.md-diagram-preview { text-align: center; margin: .8em 0; }
.md-diagram-preview svg { max-width: 100%; height: auto; }
.md-footnote-def { display: flex; gap: .5em; font-size: .9em; color: #57606a; }
.md-footnote-ref { font-size: .75em; vertical-align: super; }
.hljs-comment, .hljs-quote { color: #6e7781; font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-built_in, .hljs-type { color: #cf222e; }
.hljs-string, .hljs-attr, .hljs-symbol, .hljs-bullet, .hljs-addition { color: #0a3069; }
.hljs-number, .hljs-literal, .hljs-variable, .hljs-template-variable { color: #0550ae; }
.hljs-title, .hljs-section, .hljs-name, .hljs-selector-id, .hljs-selector-class { color: #8250df; }
.hljs-deletion { color: #82071e; }
@media print { .markdown-body { padding: 0; max-width: none; } pre, blockquote, table, img, .md-diagram-preview { break-inside: avoid; } }
`

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

export function markdownPage(body: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${KATEX_CSS}">
<style>${PAGE_CSS}</style>
</head>
<body>
<article class="markdown-body">
${body}
</article>
</body>
</html>
`
}

/** a plain-text document laid out for printing */
export function textPage(text: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>body { margin: 0; } pre { white-space: pre-wrap; word-break: break-word; font: 12px/1.6 'SF Mono', Menlo, Consolas, 'D2Coding', monospace; margin: 0; }</style>
</head>
<body><pre>${escapeHtml(text)}</pre></body>
</html>
`
}

/** document title for exports: the first heading, else the file name */
export function titleFor(editor: Editor | null, path: string | null): string {
  let heading = ''
  editor?.state.doc.descendants((node) => {
    if (heading) return false
    if (node.type.name === 'heading') heading = node.textContent.trim()
    return !heading
  })
  if (heading) return heading
  const name = path?.split(/[\\/]/).pop()
  return name ? name.replace(/\.[^.]+$/, '') : 'Untitled'
}
