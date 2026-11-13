import { decodeText } from '../../shared/encoding'
import type { EditableKind } from '../../shared/ipc'
import { markdownForWeb } from '../../web/markdownExport'
import { htmlToMarkdown } from '../html/toMarkdown'
import { htmlToText, markdownToHtml, markdownToText, textToHtml, textToMarkdown } from './textHtml'

export type ImportFormat = 'text' | 'markdown' | 'html' | 'hwp' | 'hwpx' | 'docx' | 'pdf'

export function detectImportFormat(name: string): ImportFormat | null {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? ''
  if (ext === 'txt') return 'text'
  if (ext === 'md' || ext === 'markdown' || ext === 'mdown' || ext === 'mkd') return 'markdown'
  if (ext === 'html' || ext === 'htm' || ext === 'xhtml') return 'html'
  if (ext === 'hwp') return 'hwp'
  if (ext === 'hwpx') return 'hwpx'
  if (ext === 'docx') return 'docx'
  if (ext === 'pdf') return 'pdf'
  return null
}

export function baseNameWithoutExt(name: string): string {
  const clean = name.split(/[\\/]/).pop() ?? name
  return clean.replace(/\.[^.]+$/, '') || 'Document'
}

/** Convert imported file bytes into the requested editable surface format ('text' | 'markdown' | 'html'). */
export async function importBytesToKind(params: {
  name: string
  bytes: Uint8Array
  targetKind: EditableKind
}): Promise<string> {
  const { name, bytes, targetKind } = params
  const source = detectImportFormat(name)
  if (!source) {
    throw new Error(`지원하지 않는 파일 형식입니다: ${name}`)
  }
  const title = baseNameWithoutExt(name)

  if (source === 'text') {
    const { text } = decodeText(bytes)
    if (targetKind === 'text') return text
    if (targetKind === 'markdown') return textToMarkdown(text)
    return textToHtml(text, title)
  }

  if (source === 'markdown') {
    const { text } = decodeText(bytes)
    if (targetKind === 'markdown') return text
    if (targetKind === 'text') return markdownToText(text)
    return markdownToHtml(text, title, false)
  }

  let html: string
  if (source === 'html') {
    html = decodeText(bytes).text
  } else if (source === 'docx') {
    const { docxToHtml } = await import('./docx')
    html = await docxToHtml(bytes, title)
  } else if (source === 'hwpx') {
    const { hwpxToHtml } = await import('./hwpx')
    html = await hwpxToHtml(bytes, title)
  } else if (source === 'hwp') {
    const { hwpToHtml } = await import('./hwp')
    html = await hwpToHtml(bytes, title)
  } else {
    const { pdfToHtml } = await import('./pdf')
    html = await pdfToHtml(bytes, title)
  }

  if (targetKind === 'html') return html
  if (targetKind === 'text') return htmlToText(html)
  return markdownForWeb(htmlToMarkdown(html))
}

/** Convert an editable document into plain text or Markdown string for cross-format export. */
export async function exportToTextFormat(params: {
  sourceKind: EditableKind
  content: string
  target: 'text' | 'markdown'
}): Promise<string> {
  const { sourceKind, content, target } = params
  if (target === 'text') {
    if (sourceKind === 'text') return content
    if (sourceKind === 'markdown') return markdownToText(content)
    return htmlToText(content)
  }
  if (sourceKind === 'markdown') return content
  if (sourceKind === 'text') return textToMarkdown(content)
  return markdownForWeb(htmlToMarkdown(content))
}

/** Convert an editable document (via its rendered HTML) into DOCX or HWPX binary bytes. */
export async function exportToBinaryFormat(params: {
  html: string
  title: string
  target: 'docx' | 'hwpx'
}): Promise<Uint8Array> {
  const { html, title, target } = params
  if (target === 'docx') {
    const { htmlToDocx } = await import('./docx')
    return htmlToDocx(html, title)
  }
  const { htmlToHwpx } = await import('./hwpx')
  return htmlToHwpx(html, title)
}
