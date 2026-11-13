import mammoth from 'mammoth'
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  UnderlineType,
  WidthType,
  type IParagraphOptions,
  type ParagraphChild,
} from 'docx'
import {
  parseHtmlToDocument,
  wrapHtmlDocument,
  type Align,
  type BlockNode,
  type ImageData,
  type InlineSegment,
} from './htmlModel'

const ALIGN_MAP: Record<Align, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
}

const HEADING_MAP = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
} as const

/** Convert DOCX binary bytes into a clean HTML document. */
export async function docxToHtml(bytes: Uint8Array, title = 'Document'): Promise<string> {
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  // mammoth's Node adapter reads `buffer` while its browser adapter reads `arrayBuffer`
  const input = (
    typeof Buffer !== 'undefined'
      ? { arrayBuffer, buffer: Buffer.from(bytes) }
      : { arrayBuffer }
  ) as unknown as Parameters<typeof mammoth.convertToHtml>[0]
  const result = await mammoth.convertToHtml(input, {
    styleMap: [
      "p[style-name='Title'] => h1:fresh",
      "p[style-name='Subtitle'] => h2:fresh",
      'strike => del',
      'u => u',
    ],
  })
  return wrapHtmlDocument(result.value, title)
}

function clampImageSize(width: number, height: number, maxWidth = 520): { width: number; height: number } {
  if (width <= maxWidth) return { width: Math.max(16, width), height: Math.max(16, height) }
  const ratio = maxWidth / width
  return { width: maxWidth, height: Math.max(16, Math.round(height * ratio)) }
}

async function toDocxRaster(image: ImageData): Promise<{ type: 'png' | 'jpg' | 'gif' | 'bmp'; data: Uint8Array; width: number; height: number } | null> {
  if (image.ext === 'png' || image.ext === 'jpg' || image.ext === 'gif' || image.ext === 'bmp') {
    const size = clampImageSize(image.width, image.height)
    return { type: image.ext, data: image.bytes, ...size }
  }
  if (typeof document === 'undefined' || typeof Image === 'undefined') return null
  try {
    const blob = new Blob([image.bytes as unknown as BlobPart], { type: image.mime })
    const url = URL.createObjectURL(blob)
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image()
        el.onload = () => resolve(el)
        el.onerror = () => reject(new Error('image decode failed'))
        el.src = url
      })
      const w = img.naturalWidth || image.width
      const h = img.naturalHeight || image.height
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(img, 0, 0, w, h)
      const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!pngBlob) return null
      const size = clampImageSize(w, h)
      return { type: 'png', data: new Uint8Array(await pngBlob.arrayBuffer()), ...size }
    } finally {
      URL.revokeObjectURL(url)
    }
  } catch {
    return null
  }
}

async function buildRuns(segments: InlineSegment[]): Promise<ParagraphChild[]> {
  const children: ParagraphChild[] = []
  for (const seg of segments) {
    if (seg.type === 'break') {
      children.push(new TextRun({ break: 1 }))
      continue
    }
    if (seg.type === 'image') {
      const raster = seg.image ? await toDocxRaster(seg.image) : null
      if (raster) {
        children.push(
          new ImageRun({
            type: raster.type,
            data: raster.data,
            transformation: { width: raster.width, height: raster.height },
          }),
        )
      } else if (seg.alt) {
        children.push(new TextRun({ text: `[${seg.alt}]`, italics: true, color: '666666' }))
      }
      continue
    }
    const { style } = seg
    const run = new TextRun({
      text: seg.text,
      bold: style.bold,
      italics: style.italic,
      underline: style.underline || style.link ? { type: UnderlineType.SINGLE } : undefined,
      strike: style.strike,
      subScript: style.sub,
      superScript: style.sup,
      font: style.code ? 'Consolas' : undefined,
      color: style.color ?? (style.link ? '0A69DA' : undefined),
      shading: style.code
        ? { type: ShadingType.CLEAR, fill: 'F0F2F4' }
        : style.highlight
          ? { type: ShadingType.CLEAR, fill: style.highlight }
          : undefined,
    })
    if (style.link) {
      children.push(new ExternalHyperlink({ link: style.link, children: [run] }))
    } else {
      children.push(run)
    }
  }
  return children
}

async function buildBlocks(blocks: BlockNode[]): Promise<Array<Paragraph | Table>> {
  const out: Array<Paragraph | Table> = []
  for (const block of blocks) {
    if (block.type === 'heading') {
      out.push(
        new Paragraph({
          heading: HEADING_MAP[block.level],
          alignment: block.align ? ALIGN_MAP[block.align] : undefined,
          spacing: { before: 200, after: 100 },
          children: await buildRuns(block.runs),
        }),
      )
      continue
    }
    if (block.type === 'paragraph') {
      const opts: Record<string, unknown> = {
        alignment: block.align ? ALIGN_MAP[block.align] : undefined,
        spacing: { after: 120 },
        children: await buildRuns(block.runs),
      }
      if (block.quote) {
        opts.indent = { left: 420 }
        opts.border = { left: { style: BorderStyle.SINGLE, size: 12, color: 'D0D7DE', space: 10 } }
      }
      if (block.list) {
        const level = Math.min(8, block.list.level)
        if (block.list.ordered) {
          opts.numbering = { reference: 'ordered-list', level }
        } else {
          opts.bullet = { level }
        }
      }
      out.push(new Paragraph(opts as IParagraphOptions))
      continue
    }
    if (block.type === 'code') {
      const lines = block.text.split('\n')
      const runs: TextRun[] = []
      lines.forEach((line, i) => {
        if (i > 0) runs.push(new TextRun({ break: 1 }))
        runs.push(new TextRun({ text: line, font: 'Consolas', size: 19 }))
      })
      out.push(
        new Paragraph({
          shading: { type: ShadingType.CLEAR, fill: 'F6F8FA' },
          border: {
            top: { style: BorderStyle.SINGLE, size: 4, color: 'D8DEE4', space: 6 },
            bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D8DEE4', space: 6 },
            left: { style: BorderStyle.SINGLE, size: 4, color: 'D8DEE4', space: 8 },
            right: { style: BorderStyle.SINGLE, size: 4, color: 'D8DEE4', space: 8 },
          },
          spacing: { before: 120, after: 120 },
          children: runs,
        }),
      )
      continue
    }
    if (block.type === 'hr') {
      out.push(
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D0D7DE', space: 4 } },
          spacing: { before: 120, after: 120 },
          children: [],
        }),
      )
      continue
    }
    if (block.type === 'table') {
      const rows: TableRow[] = []
      for (const row of block.rows) {
        const cells: TableCell[] = []
        for (const cell of row) {
          const children = await buildBlocks(cell.blocks)
          cells.push(
            new TableCell({
              columnSpan: cell.colSpan > 1 ? cell.colSpan : undefined,
              rowSpan: cell.rowSpan > 1 ? cell.rowSpan : undefined,
              shading: cell.header ? { type: ShadingType.CLEAR, fill: 'F6F8FA' } : undefined,
              margins: { top: 80, bottom: 80, left: 120, right: 120 },
              children: children.length > 0 ? children : [new Paragraph('')],
            }),
          )
        }
        rows.push(new TableRow({ tableHeader: row.some((c) => c.header), children: cells }))
      }
      out.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows,
        }),
      )
    }
  }
  return out
}

/** Convert an HTML document into DOCX binary bytes. */
export async function htmlToDocx(html: string, fallbackTitle = 'Document'): Promise<Uint8Array> {
  const parsed = await parseHtmlToDocument(html, fallbackTitle)
  const children = await buildBlocks(parsed.blocks)
  const doc = new Document({
    title: parsed.title,
    numbering: {
      config: [
        {
          reference: 'ordered-list',
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: (level + 1) * 360, hanging: 240 } } },
          })),
        },
      ],
    },
    styles: {
      default: {
        document: {
          run: {
            font: 'Malgun Gothic',
            size: 21,
          },
        },
      },
    },
    sections: [
      {
        children: children.length > 0 ? children : [new Paragraph('')],
      },
    ],
  })
  return Packer.pack(doc, 'uint8array')
}
