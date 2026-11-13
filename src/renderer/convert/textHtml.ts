import { marked } from 'marked'
import { markdownPage } from '../exportPage'
import { escapeXml, wrapHtmlDocument } from './htmlModel'

function escapeHtmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n(?:\r?\n)?/, '')
}

/** Convert plain text into a clean HTML document preserving paragraph and line breaks. */
export function textToHtml(text: string, title = 'Document'): string {
  const normalized = text.replace(/\r\n?/g, '\n')
  if (!normalized.trim()) return wrapHtmlDocument('<p></p>', title)
  const paragraphs = normalized.split(/\n{2,}/)
  const body = paragraphs
    .map((para) => `<p>${escapeHtmlText(para).replace(/\n/g, '<br>')}</p>`)
    .join('\n')
  return wrapHtmlDocument(body, title)
}

/** Convert plain text into Markdown (normalizing line endings). */
export function textToMarkdown(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n')
  if (!normalized) return ''
  return normalized.endsWith('\n') ? normalized : `${normalized}\n`
}

/** Convert Markdown into clean semantic HTML suitable for HTML editing or further conversion. */
export async function markdownToHtml(markdown: string, title = 'Document', styled = false): Promise<string> {
  const body = await marked.parse(stripFrontmatter(markdown), { gfm: true, breaks: false, async: true })
  return styled ? markdownPage(body, title) : wrapHtmlDocument(body.trim(), title)
}

const SKIP_TEXT_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'HEAD', 'TITLE'])

function collectNodeText(node: Node, indent = 0): string {
  if (node.nodeType === 3) {
    return (node.textContent ?? '').replace(/[\r\n\t]+/g, ' ')
  }
  if (node.nodeType !== 1) return ''
  const el = node as HTMLElement
  const tag = el.tagName.toUpperCase()
  if (SKIP_TEXT_TAGS.has(tag)) return ''
  if (tag === 'BR') return '\n'
  if (tag === 'HR') return '\n---\n\n'
  if (tag === 'IMG') {
    const alt = el.getAttribute('alt')?.trim()
    return alt ? `[${alt}]` : ''
  }
  if (tag === 'PRE') {
    const raw = (el.textContent ?? '').replace(/\r\n?/g, '\n').replace(/\n$/, '')
    return raw ? `${raw}\n\n` : ''
  }
  if (tag === 'TABLE') {
    const lines: string[] = []
    for (const tr of Array.from(el.querySelectorAll('tr'))) {
      const cells = Array.from(tr.children)
        .filter((c) => c.tagName === 'TD' || c.tagName === 'TH')
        .map((c) => collectInlinePlain(c).trim().replace(/\s+/g, ' '))
      if (cells.length > 0) lines.push(cells.join('\t'))
    }
    return lines.length > 0 ? `${lines.join('\n')}\n\n` : ''
  }
  if (tag === 'UL' || tag === 'OL') {
    const ordered = tag === 'OL'
    let index = Number(el.getAttribute('start') ?? '1') || 1
    const lines: string[] = []
    for (const child of Array.from(el.children)) {
      if (child.tagName.toUpperCase() !== 'LI') continue
      const li = child as HTMLElement
      const checkedAttr = li.getAttribute('data-checked')
      const checkbox = li.querySelector(':scope > input[type="checkbox"], :scope > label > input[type="checkbox"]') as HTMLInputElement | null
      let prefix = ordered ? `${index++}. ` : '• '
      if (checkedAttr === 'true' || checkbox?.checked || checkbox?.hasAttribute('checked')) prefix = '[x] '
      else if (checkedAttr === 'false' || checkbox) prefix = '[ ] '

      const inlineParts: string[] = []
      const nestedParts: string[] = []
      for (const liChild of Array.from(li.childNodes)) {
        if (liChild.nodeType === 1) {
          const cTag = (liChild as HTMLElement).tagName.toUpperCase()
          if (cTag === 'UL' || cTag === 'OL') {
            nestedParts.push(collectNodeText(liChild, indent + 1).trimEnd())
            continue
          }
          if (cTag === 'LABEL' && checkbox && (liChild as HTMLElement).contains(checkbox)) continue
          if (cTag === 'INPUT' && liChild === checkbox) continue
        }
        inlineParts.push(collectInlinePlain(liChild))
      }
      const lineText = inlineParts.join('').replace(/\s+/g, ' ').trim()
      const pad = '  '.repeat(indent)
      if (lineText) lines.push(`${pad}${prefix}${lineText}`)
      for (const nested of nestedParts) if (nested) lines.push(nested)
    }
    return lines.length > 0 ? `${lines.join('\n')}${indent === 0 ? '\n\n' : ''}` : ''
  }

  if (tag === 'BLOCKQUOTE') {
    const inner = Array.from(el.childNodes).map((c) => collectNodeText(c, indent)).join('').trim()
    if (!inner) return ''
    return `${inner.split('\n').map((line) => `> ${line}`).join('\n')}\n\n`
  }

  const isBlock = /^(H[1-6]|P|DIV|SECTION|ARTICLE|HEADER|FOOTER|MAIN|ASIDE|FIGURE|FIGCAPTION)$/.test(tag)
  let inner = ''
  for (const child of Array.from(el.childNodes)) inner += collectNodeText(child, indent)
  if (!isBlock) return inner
  const trimmed = inner.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').trim()
  return trimmed ? `${trimmed}\n\n` : ''
}

function collectInlinePlain(node: Node): string {
  if (node.nodeType === 3) return (node.textContent ?? '').replace(/[\r\n\t]+/g, ' ')
  if (node.nodeType !== 1) return ''
  const el = node as HTMLElement
  const tag = el.tagName.toUpperCase()
  if (SKIP_TEXT_TAGS.has(tag)) return ''
  if (tag === 'BR') return '\n'
  if (tag === 'IMG') {
    const alt = el.getAttribute('alt')?.trim()
    return alt ? `[${alt}]` : ''
  }
  return Array.from(el.childNodes).map(collectInlinePlain).join('')
}

/** Extract clean, readable plain text from an HTML document or fragment. */
export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  if (!doc.body) return ''
  const raw = Array.from(doc.body.childNodes)
    .map((child) => collectNodeText(child))
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return raw ? `${raw}\n` : ''
}

/** Extract clean plain text from Markdown source. */
export async function markdownToText(markdown: string): Promise<string> {
  const html = await markdownToHtml(markdown)
  return htmlToText(html)
}

export { escapeXml }
