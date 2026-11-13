export type Align = 'left' | 'center' | 'right' | 'justify'

export interface InlineStyle {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  code?: boolean
  sub?: boolean
  sup?: boolean
  highlight?: string
  color?: string
  link?: string
}

export interface ImageData {
  mime: string
  ext: 'png' | 'jpg' | 'gif' | 'bmp' | 'webp' | 'svg'
  bytes: Uint8Array
  width: number
  height: number
}

export type InlineSegment =
  | { type: 'text'; text: string; style: InlineStyle }
  | { type: 'break' }
  | { type: 'image'; src: string; alt: string; image?: ImageData }

export interface TableCellModel {
  header: boolean
  colSpan: number
  rowSpan: number
  blocks: BlockNode[]
}

export type BlockNode =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; align?: Align; runs: InlineSegment[] }
  | {
      type: 'paragraph'
      align?: Align
      quote?: boolean
      list?: { ordered: boolean; level: number; index?: number }
      runs: InlineSegment[]
    }
  | { type: 'code'; text: string }
  | { type: 'hr' }
  | { type: 'table'; rows: TableCellModel[][] }

export interface ParsedDocument {
  title: string
  blocks: BlockNode[]
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED'])
const BLOCK_TAGS = new Set([
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'DIV', 'BLOCKQUOTE', 'PRE', 'UL', 'OL', 'LI', 'HR', 'TABLE',
  'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'NAV', 'FIGURE', 'FIGCAPTION',
])

const NAMED_COLORS: Record<string, string> = {
  black: '000000',
  white: 'FFFFFF',
  red: 'FF0000',
  green: '008000',
  blue: '0000FF',
  gray: '808080',
  grey: '808080',
  yellow: 'FFFF00',
  orange: 'FFA500',
  purple: '800080',
  navy: '000080',
  teal: '008080',
}

/** Convert a CSS color value (#rgb, #rrggbb, rgb(...), or common name) to 6-digit hex. */
export function normalizeHexColor(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  const raw = value.trim().toLowerCase()
  if (NAMED_COLORS[raw]) return NAMED_COLORS[raw]
  const hex6 = /^#([0-9a-f]{6})$/i.exec(raw)
  if (hex6) return hex6[1]!.toUpperCase()
  const hex3 = /^#([0-9a-f]{3})$/i.exec(raw)
  if (hex3) return hex3[1]!.split('').map((c) => c + c).join('').toUpperCase()
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(raw)
  if (rgb) {
    return [rgb[1], rgb[2], rgb[3]]
      .map((n) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0').toUpperCase())
      .join('')
  }
  return undefined
}

function parseAlign(el: HTMLElement): Align | undefined {
  const styleAlign = el.style?.textAlign?.toLowerCase() || el.getAttribute('align')?.toLowerCase()
  if (styleAlign === 'left' || styleAlign === 'center' || styleAlign === 'right' || styleAlign === 'justify') {
    return styleAlign
  }
  return undefined
}

function decodeBase64(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'))
  }
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

export function encodeBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function extForMime(mime: string): ImageData['ext'] {
  const lower = mime.toLowerCase()
  if (lower.includes('png')) return 'png'
  if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg'
  if (lower.includes('gif')) return 'gif'
  if (lower.includes('bmp')) return 'bmp'
  if (lower.includes('webp')) return 'webp'
  if (lower.includes('svg')) return 'svg'
  return 'png'
}

/** Read pixel dimensions directly from PNG/JPEG/GIF/BMP/WEBP/SVG headers without requiring canvas. */
export function readImageDimensions(bytes: Uint8Array, ext: ImageData['ext']): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (ext === 'png' && bytes.length >= 24 && view.getUint32(0) === 0x89504e47) {
    return { width: view.getUint32(16), height: view.getUint32(20) }
  }
  if (ext === 'gif' && bytes.length >= 10) {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) }
  }
  if (ext === 'bmp' && bytes.length >= 26) {
    return { width: Math.abs(view.getInt32(18, true)), height: Math.abs(view.getInt32(22, true)) }
  }
  if (ext === 'jpg' && bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) break
      const marker = bytes[i + 1]!
      const len = view.getUint16(i + 2)
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb)) {
        return { height: view.getUint16(i + 5), width: view.getUint16(i + 7) }
      }
      if (len < 2) break
      i += 2 + len
    }
  }
  if (ext === 'svg') {
    const text = new TextDecoder().decode(bytes.subarray(0, 2048))
    const w = /\bwidth\s*=\s*["'](\d+(?:\.\d+)?)/i.exec(text)?.[1]
    const h = /\bheight\s*=\s*["'](\d+(?:\.\d+)?)/i.exec(text)?.[1]
    if (w && h) return { width: Math.max(1, Math.round(Number(w))), height: Math.max(1, Math.round(Number(h))) }
  }
  return { width: 320, height: 200 }
}

async function resolveImageData(src: string): Promise<ImageData | undefined> {
  if (!src) return undefined
  try {
    if (src.startsWith('data:image/')) {
      const match = /^data:(image\/[a-z0-9.+-]+)(?:;[^,]*)?;base64,(.+)$/i.exec(src)
      if (match) {
        const mime = match[1]!.toLowerCase()
        const ext = extForMime(mime)
        const bytes = decodeBase64(match[2]!.replace(/\s+/g, ''))
        const { width, height } = readImageDimensions(bytes, ext)
        return { mime, ext, bytes, width, height }
      }
      const utf8Match = /^data:(image\/svg\+xml)(?:;charset=[^,]*)?,(.*)$/i.exec(src)
      if (utf8Match) {
        const bytes = new TextEncoder().encode(decodeURIComponent(utf8Match[2]!))
        const { width, height } = readImageDimensions(bytes, 'svg')
        return { mime: 'image/svg+xml', ext: 'svg', bytes, width, height }
      }
      return undefined
    }
    if (src.startsWith('md-asset://') && typeof fetch === 'function') {
      const res = await fetch(src)
      if (!res.ok) return undefined
      const blob = await res.blob()
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const mime = blob.type || 'image/png'
      const ext = extForMime(mime)
      const { width, height } = readImageDimensions(bytes, ext)
      return { mime, ext, bytes, width, height }
    }
  } catch {
    return undefined
  }
  return undefined
}

function collectSvgDiagram(svgEl: SVGElement): ImageData | undefined {
  try {
    const cloned = svgEl.cloneNode(true) as SVGElement
    if (!cloned.getAttribute('xmlns')) cloned.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    const raw = new XMLSerializer().serializeToString(cloned)
    const bytes = new TextEncoder().encode(raw)
    const vb = cloned.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number)
    const w = Number(cloned.getAttribute('width')) || (vb && vb.length === 4 ? vb[2]! : 360)
    const h = Number(cloned.getAttribute('height')) || (vb && vb.length === 4 ? vb[3]! : 200)
    return { mime: 'image/svg+xml', ext: 'svg', bytes, width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) }
  } catch {
    return undefined
  }
}

async function collectInlines(node: Node, style: InlineStyle, out: InlineSegment[]): Promise<void> {
  if (node.nodeType === 3) {
    const text = (node.textContent ?? '').replace(/[\r\n\t]+/g, ' ')
    if (text) out.push({ type: 'text', text, style })
    return
  }
  if (node.nodeType !== 1) return
  const el = node as HTMLElement
  const tag = el.tagName.toUpperCase()
  if (SKIP_TAGS.has(tag)) return
  if (tag === 'BR') {
    out.push({ type: 'break' })
    return
  }
  if (tag === 'IMG') {
    const src = el.getAttribute('src') ?? ''
    const alt = el.getAttribute('alt') ?? ''
    const image = await resolveImageData(src)
    out.push({ type: 'image', src, alt, image })
    return
  }
  if (tag === 'SVG') {
    const image = collectSvgDiagram(el as unknown as SVGElement)
    if (image) out.push({ type: 'image', src: '', alt: 'diagram', image })
    return
  }
  if (tag === 'INPUT' && (el as HTMLInputElement).type === 'checkbox') {
    const checked = (el as HTMLInputElement).checked || el.hasAttribute('checked')
    out.push({ type: 'text', text: checked ? '☑ ' : '☐ ', style })
    return
  }

  const next: InlineStyle = { ...style }
  if (tag === 'STRONG' || tag === 'B') next.bold = true
  else if (tag === 'EM' || tag === 'I') next.italic = true
  else if (tag === 'U') next.underline = true
  else if (tag === 'DEL' || tag === 'S' || tag === 'STRIKE') next.strike = true
  else if (tag === 'CODE' || tag === 'KBD' || tag === 'SAMP') next.code = true
  else if (tag === 'SUB') next.sub = true
  else if (tag === 'SUP') next.sup = true
  else if (tag === 'MARK') next.highlight = normalizeHexColor(el.style?.backgroundColor) ?? 'FFFF00'
  else if (tag === 'A') {
    const href = el.getAttribute('href')
    if (href && !/^(?:javascript|vbscript):/i.test(href.trim())) next.link = href
  }

  if (el.style) {
    if (el.style.fontWeight === 'bold' || Number(el.style.fontWeight) >= 600) next.bold = true
    if (el.style.fontStyle === 'italic') next.italic = true
    if (el.style.textDecoration?.includes('underline')) next.underline = true
    if (el.style.textDecoration?.includes('line-through')) next.strike = true
    const color = normalizeHexColor(el.style.color)
    if (color) next.color = color
    const bg = normalizeHexColor(el.style.backgroundColor)
    if (bg && !next.highlight) next.highlight = bg
  }

  for (const child of Array.from(el.childNodes)) {
    await collectInlines(child, next, out)
  }
}

async function collectList(
  listEl: HTMLElement,
  ordered: boolean,
  level: number,
  blocks: BlockNode[],
): Promise<void> {
  let index = Number(listEl.getAttribute('start') ?? '1') || 1
  for (const child of Array.from(listEl.children)) {
    if (child.tagName.toUpperCase() !== 'LI') continue
    const li = child as HTMLElement
    const checkedAttr = li.getAttribute('data-checked')
    const hasCheckbox = li.querySelector(':scope > input[type="checkbox"], :scope > label > input[type="checkbox"]')
    const runs: InlineSegment[] = []
    if (checkedAttr === 'true' || checkedAttr === 'false') {
      runs.push({ type: 'text', text: checkedAttr === 'true' ? '☑ ' : '☐ ', style: {} })
    }

    const nestedLists: HTMLElement[] = []
    for (const liChild of Array.from(li.childNodes)) {
      if (liChild.nodeType === 1) {
        const cTag = (liChild as HTMLElement).tagName.toUpperCase()
        if (cTag === 'UL' || cTag === 'OL') {
          nestedLists.push(liChild as HTMLElement)
          continue
        }
        if (cTag === 'LABEL' && hasCheckbox && (liChild as HTMLElement).querySelector('input[type="checkbox"]')) {
          if (checkedAttr !== 'true' && checkedAttr !== 'false') {
            await collectInlines(liChild, {}, runs)
          }
          continue
        }
      }
      await collectInlines(liChild, {}, runs)
    }

    blocks.push({
      type: 'paragraph',
      align: parseAlign(li),
      list: { ordered: !hasCheckbox && checkedAttr === null && ordered, level, index },
      runs: trimRuns(runs),
    })
    index++
    for (const nested of nestedLists) {
      await collectList(nested, nested.tagName.toUpperCase() === 'OL', level + 1, blocks)
    }
  }
}

function trimRuns(runs: InlineSegment[]): InlineSegment[] {
  const out: InlineSegment[] = []
  for (const run of runs) {
    if (run.type === 'text') {
      const prev = out[out.length - 1]
      if (prev && prev.type === 'text' && JSON.stringify(prev.style) === JSON.stringify(run.style)) {
        prev.text += run.text
        continue
      }
    }
    out.push({ ...run })
  }
  if (out.length > 0 && out[0]!.type === 'text') out[0]!.text = out[0]!.text.replace(/^\s+/, '')
  const last = out[out.length - 1]
  if (last && last.type === 'text') last.text = last.text.replace(/\s+$/, '')
  return out.filter((r) => r.type !== 'text' || r.text.length > 0)
}

async function collectTable(tableEl: HTMLElement): Promise<BlockNode | null> {
  const rows: TableCellModel[][] = []
  const trs = Array.from(tableEl.querySelectorAll(':scope > tr, :scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr'))
  for (const tr of trs) {
    const rowCells: TableCellModel[] = []
    for (const cellEl of Array.from(tr.children)) {
      const tag = cellEl.tagName.toUpperCase()
      if (tag !== 'TD' && tag !== 'TH') continue
      const cell = cellEl as HTMLElement
      const colSpan = Math.max(1, Number(cell.getAttribute('colspan') ?? '1') || 1)
      const rowSpan = Math.max(1, Number(cell.getAttribute('rowspan') ?? '1') || 1)
      const cellBlocks: BlockNode[] = []
      await collectContainerBlocks(cell, cellBlocks)
      if (cellBlocks.length === 0) cellBlocks.push({ type: 'paragraph', runs: [] })
      rowCells.push({
        header: tag === 'TH' || tr.parentElement?.tagName.toUpperCase() === 'THEAD',
        colSpan,
        rowSpan,
        blocks: cellBlocks,
      })
    }
    if (rowCells.length > 0) rows.push(rowCells)
  }
  return rows.length > 0 ? { type: 'table', rows } : null
}

async function collectContainerBlocks(container: HTMLElement, blocks: BlockNode[], quote = false): Promise<void> {
  let inlineBuffer: Node[] = []
  const flushInlines = async () => {
    if (inlineBuffer.length === 0) return
    const runs: InlineSegment[] = []
    for (const node of inlineBuffer) await collectInlines(node, {}, runs)
    inlineBuffer = []
    const cleaned = trimRuns(runs)
    if (cleaned.length > 0) blocks.push({ type: 'paragraph', quote, runs: cleaned })
  }

  for (const child of Array.from(container.childNodes)) {
    if (child.nodeType === 3) {
      if ((child.textContent ?? '').trim() || inlineBuffer.length > 0) inlineBuffer.push(child)
      continue
    }
    if (child.nodeType !== 1) continue
    const el = child as HTMLElement
    const tag = el.tagName.toUpperCase()
    if (SKIP_TAGS.has(tag)) continue

    if (!BLOCK_TAGS.has(tag)) {
      inlineBuffer.push(el)
      continue
    }

    await flushInlines()

    if (/^H([1-6])$/.test(tag)) {
      const level = Number(tag[1]) as 1 | 2 | 3 | 4 | 5 | 6
      const runs: InlineSegment[] = []
      await collectInlines(el, {}, runs)
      blocks.push({ type: 'heading', level, align: parseAlign(el), runs: trimRuns(runs) })
    } else if (tag === 'P') {
      const runs: InlineSegment[] = []
      await collectInlines(el, {}, runs)
      blocks.push({ type: 'paragraph', align: parseAlign(el), quote, runs: trimRuns(runs) })
    } else if (tag === 'PRE') {
      const text = (el.textContent ?? '').replace(/\r\n/g, '\n').replace(/\n$/, '')
      blocks.push({ type: 'code', text })
    } else if (tag === 'HR') {
      blocks.push({ type: 'hr' })
    } else if (tag === 'BLOCKQUOTE') {
      await collectContainerBlocks(el, blocks, true)
    } else if (tag === 'UL' || tag === 'OL') {
      await collectList(el, tag === 'OL', 0, blocks)
    } else if (tag === 'TABLE') {
      const table = await collectTable(el)
      if (table) blocks.push(table)
    } else if (el.classList.contains('md-diagram-preview')) {
      const svg = el.querySelector('svg')
      if (svg) {
        const image = collectSvgDiagram(svg)
        if (image) blocks.push({ type: 'paragraph', align: 'center', runs: [{ type: 'image', src: '', alt: 'diagram', image }] })
      }
    } else {
      await collectContainerBlocks(el, blocks, quote)
    }
  }
  await flushInlines()
}

export async function parseHtmlToDocument(html: string, fallbackTitle = 'Document'): Promise<ParsedDocument> {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const title = doc.querySelector('title')?.textContent?.trim() || fallbackTitle
  const blocks: BlockNode[] = []
  if (doc.body) {
    await collectContainerBlocks(doc.body, blocks)
  }
  return { title, blocks }
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function wrapHtmlDocument(bodyHtml: string, title = 'Document'): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>${escapeXml(title)}</title>
</head>
<body>
${bodyHtml}
</body>
</html>
`
}
