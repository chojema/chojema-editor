/**
 * Round-trip envelope for an .html file. The visual editor only ever sees the
 * inside of <body>; everything before it (doctype, <head>, the <body> tag
 * itself) and after it is kept as the original text and written back
 * unchanged, so editing a paragraph never rewrites the head.
 */
export interface HtmlEnvelope {
  /** original text up to and including the opening <body> tag ('' for a fragment) */
  prefix: string
  /** original text from </body> to the end ('' for a fragment) */
  suffix: string
  /** markup inside <body>, or the whole file for a fragment */
  body: string
  /** attributes of the <body> tag, applied to the editing canvas */
  bodyAttrs: Record<string, string>
  eol: '\n' | '\r\n'
  bom: boolean
}

const BODY_OPEN = /<body\b[^>]*>/i
const BODY_CLOSE = /<\/body\s*>/gi

export function parseHtmlDocument(raw: string): HtmlEnvelope {
  const bom = raw.startsWith('\uFEFF')
  if (bom) raw = raw.slice(1)
  const eol: HtmlEnvelope['eol'] = raw.includes('\r\n') ? '\r\n' : '\n'
  const text = raw.replace(/\r\n/g, '\n')

  const open = BODY_OPEN.exec(text)
  if (open) {
    const bodyStart = open.index + open[0].length
    let closeAt = -1
    for (const match of text.matchAll(BODY_CLOSE)) {
      if (match.index >= bodyStart) closeAt = match.index
    }
    if (closeAt < 0) closeAt = text.search(/<\/html\s*>/i)
    if (closeAt < 0) closeAt = text.length
    return {
      prefix: text.slice(0, bodyStart),
      suffix: text.slice(closeAt),
      body: text.slice(bodyStart, closeAt),
      bodyAttrs: tagAttributes(open[0]),
      eol,
      bom,
    }
  }

  // a document with a head but no <body> tag: everything after </head> is the body
  const headClose = /<\/head\s*>/i.exec(text)
  if (headClose) {
    const bodyStart = headClose.index + headClose[0].length
    const htmlClose = text.search(/<\/html\s*>/i)
    const end = htmlClose >= bodyStart ? htmlClose : text.length
    return {
      prefix: text.slice(0, bodyStart),
      suffix: text.slice(end),
      body: text.slice(bodyStart, end),
      bodyAttrs: {},
      eol,
      bom,
    }
  }

  return { prefix: '', suffix: '', body: text, bodyAttrs: {}, eol, bom }
}

function tagAttributes(tag: string): Record<string, string> {
  const doc = new DOMParser().parseFromString(`<div ${tag.slice(5, -1)}></div>`, 'text/html')
  const el = doc.body.firstElementChild
  const out: Record<string, string> = {}
  for (const attr of Array.from(el?.attributes ?? [])) out[attr.name] = attr.value
  return out
}

export function serializeHtmlDocument(envelope: HtmlEnvelope, bodyHtml: string): string {
  const body = formatHtml(bodyHtml)
  let text: string
  if (envelope.prefix || envelope.suffix) {
    text = `${envelope.prefix.replace(/\n*$/, '')}\n${body}\n${envelope.suffix.replace(/^\n*/, '')}`
  } else {
    text = `${body}\n`
  }
  if (envelope.eol === '\r\n') text = text.replace(/\n/g, '\r\n')
  return envelope.bom ? `\uFEFF${text}` : text
}

const BLOCK_TAGS =
  'p|h[1-6]|ul|ol|li|blockquote|pre|table|thead|tbody|tfoot|tr|th|td|caption|colgroup|col|hr|div|section|article|header|footer|main|nav|aside|figure|figcaption|address|center|dl|dt|dd|form|fieldset|details|summary|iframe|video|audio|script|style|noscript|template|svg|canvas|object|picture|br'

/** containers whose opening tag also starts a new line */
const CONTAINER_OPEN =
  /<(ul|ol|table|thead|tbody|tfoot|tr|blockquote|div|section|article|header|footer|main|nav|aside|figure|dl|form|fieldset|details)\b[^>]*>(?=<)/gi
const BLOCK_CLOSE = new RegExp(`(</(?:${BLOCK_TAGS})>|<(?:hr|br|col)\\b[^>]*>)(?=<)`, 'gi')

/**
 * TipTap emits the body as one long line. Put each block on its own line so
 * the saved file stays readable and diffs stay small. Text inside <pre>,
 * <script>, <style> and <textarea> is left exactly as it is.
 */
export function formatHtml(html: string): string {
  const keep: string[] = []
  const shielded = html.replace(
    /<(pre|script|style|textarea)\b[\s\S]*?<\/\1>/gi,
    (match) => `\u0000${keep.push(match) - 1}\u0000`,
  )
  const formatted = shielded
    .replace(CONTAINER_OPEN, (match) => `${match}\n`)
    .replace(BLOCK_CLOSE, (match) => `${match}\n`)
    .replace(/(\u0000\d+\u0000)(?=<)/g, '$1\n')
    .replace(/>(\u0000\d+\u0000)/g, '>\n$1')
  return formatted.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => keep[Number(i)]!).trim()
}

/**
 * Take back what the editor adds on its own when it writes HTML:
 * - the paragraph TipTap puts inside flagged cells and list items (a lone,
 *   attribute-free <p> hands its content back to its parent);
 * - table defaults: colspan/rowspan="1", the min-width style and the
 *   <colgroup> of min-width-only columns the table renderer generates.
 */
export function cleanSerializedHtml(html: string, bareAttr: string): string {
  if (!html.includes(bareAttr) && !html.includes('<table')) return html
  const template = document.createElement('template')
  template.innerHTML = html
  const root = template.content
  for (const el of Array.from(root.querySelectorAll(`[${bareAttr}]`))) {
    el.removeAttribute(bareAttr)
    const only = el.children.length === 1 ? el.firstElementChild : null
    const textAround = Array.from(el.childNodes).some(
      (node) => node.nodeType === 3 && (node.textContent ?? '').trim() !== '',
    )
    if (only?.tagName === 'P' && only.attributes.length === 0 && !textAround) {
      only.replaceWith(...Array.from(only.childNodes))
    }
  }
  for (const cell of Array.from(root.querySelectorAll('td, th'))) {
    for (const name of ['colspan', 'rowspan']) {
      if (cell.getAttribute(name) === '1') cell.removeAttribute(name)
    }
  }
  const generatedMinWidth = /(?:^|;)\s*min-width:\s*\d+px;?/
  for (const table of Array.from(root.querySelectorAll('table'))) {
    const style = table.getAttribute('style')
    if (style && generatedMinWidth.test(style)) {
      const rest = style.replace(generatedMinWidth, '').trim().replace(/^;\s*/, '')
      if (rest) table.setAttribute('style', rest)
      else table.removeAttribute('style')
    }
    for (const group of Array.from(table.querySelectorAll(':scope > colgroup'))) {
      const generated = Array.from(group.children).every(
        (col) =>
          col.tagName === 'COL' &&
          col.attributes.length === 1 &&
          /^min-width:\s*\d+px;?$/.test(col.getAttribute('style') ?? ''),
      )
      if (generated) group.remove()
    }
  }
  return template.innerHTML
}

export const NEW_HTML_DOCUMENT = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>제목 없음</title>
<style>
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif;
  line-height: 1.7;
  color: #222;
  max-width: 800px;
  margin: 2rem auto;
  padding: 0 1rem;
}
</style>
</head>
<body>
<p></p>
</body>
</html>
`

/** stylesheet sources a document's head (and inline <style> blocks) bring along */
export interface StyleSource {
  /** inline CSS text, or null when it must be fetched */
  css: string | null
  /** href of a linked stylesheet, relative or absolute */
  href: string | null
}

export function collectStyleSources(html: string): StyleSource[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const out: StyleSource[] = []
  for (const el of Array.from(doc.querySelectorAll('style, link[rel~="stylesheet" i]'))) {
    if (el.tagName.toLowerCase() === 'style') out.push({ css: el.textContent ?? '', href: null })
    else {
      const href = el.getAttribute('href')
      if (href) out.push({ css: null, href })
    }
  }
  return out
}
