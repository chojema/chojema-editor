import { wrapHtmlDocument } from './htmlModel'

interface PositionedText {
  str: string
  x: number
  y: number
  width: number
  height: number
}

interface TextLine {
  y: number
  height: number
  text: string
  xStart: number
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function isCjkChar(ch: string): boolean {
  return /[\u1100-\u11FF\u3040-\u30FF\u3130-\u318F\u4E00-\u9FFF\uAC00-\uD7AF]/.test(ch)
}

/** Join consecutive wrapped lines naturally (avoid inserting spaces inside Korean/CJK words when unnecessary). */
function joinLines(lines: string[]): string {
  let out = ''
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (!out) {
      out = trimmed
      continue
    }
    if (out.endsWith('-')) {
      out = out.slice(0, -1) + trimmed
      continue
    }
    const lastCh = out[out.length - 1]!
    const firstCh = trimmed[0]!
    if (isCjkChar(lastCh) && isCjkChar(firstCh)) {
      out += trimmed
    } else {
      out += ` ${trimmed}`
    }
  }
  return out
}

function buildLines(items: PositionedText[]): TextLine[] {
  const nonEmpty = items.filter((item) => item.str.trim().length > 0)
  if (nonEmpty.length === 0) return []

  // PDF coordinates start from bottom-left; sort top-to-bottom, left-to-right
  const sorted = [...nonEmpty].sort((a, b) => {
    const tol = Math.max(2, Math.min(a.height, b.height) * 0.45)
    if (Math.abs(a.y - b.y) > tol) return b.y - a.y
    return a.x - b.x
  })

  const groups: PositionedText[][] = []
  for (const item of sorted) {
    const lastGroup = groups[groups.length - 1]
    if (!lastGroup) {
      groups.push([item])
      continue
    }
    const ref = lastGroup[0]!
    const tol = Math.max(2, Math.min(ref.height, item.height) * 0.45)
    if (Math.abs(ref.y - item.y) <= tol) {
      lastGroup.push(item)
    } else {
      groups.push([item])
    }
  }

  return groups.map((group) => {
    group.sort((a, b) => a.x - b.x)
    let text = ''
    let prevEnd = group[0]!.x
    let maxHeight = 0
    for (const item of group) {
      if (item.height > maxHeight) maxHeight = item.height
      if (text) {
        const gap = item.x - prevEnd
        const spaceThreshold = Math.max(1.5, (item.height || 10) * 0.2)
        if (gap > spaceThreshold && !text.endsWith(' ') && !item.str.startsWith(' ')) {
          text += ' '
        }
      }
      text += item.str
      prevEnd = Math.max(prevEnd, item.x + item.width)
    }
    return {
      y: group[0]!.y,
      height: maxHeight || 10,
      text: text.trim(),
      xStart: group[0]!.x,
    }
  })
}

function medianHeight(lines: TextLine[]): number {
  const sizes = lines.map((l) => l.height).filter((h) => h > 0).sort((a, b) => a - b)
  if (sizes.length === 0) return 10
  return sizes[Math.floor(sizes.length / 2)]!
}

function headingLevelFor(height: number, bodySize: number, text: string): number | null {
  if (text.length > 140) return null
  const ratio = height / bodySize
  if (ratio >= 1.65) return 1
  if (ratio >= 1.35) return 2
  if (ratio >= 1.15) return 3
  return null
}

async function loadPdfJs() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const isNodeTest = typeof process !== 'undefined' && !!process.versions?.node
  if (isNodeTest) {
    const g = globalThis as Record<string, unknown>
    if (!g.pdfjsWorker) {
      g.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
    }
  } else if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    const workerMod = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')
    pdfjs.GlobalWorkerOptions.workerSrc = workerMod.default
  }
  return pdfjs
}

/** Extract text, headings, lists, and paragraphs from a text-based PDF into HTML. */
export async function pdfToHtml(bytes: Uint8Array, title = 'Document'): Promise<string> {
  const pdfjs = await loadPdfJs()
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    verbosity: 0,
  })
  const pdf = await loadingTask.promise

  try {
    const pageLines: TextLine[][] = []
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p)
      const content = await page.getTextContent()
      const items: PositionedText[] = []
      for (const raw of content.items) {
        if (!('str' in raw) || typeof raw.str !== 'string') continue
        const tx = raw.transform
        const height = Math.hypot(tx[2] ?? 0, tx[3] ?? 0) || Math.abs(raw.height || 10)
        items.push({
          str: raw.str,
          x: tx[4] ?? 0,
          y: tx[5] ?? 0,
          width: raw.width ?? 0,
          height,
        })
      }
      pageLines.push(buildLines(items))
    }

    const allLines = pageLines.flat()
    if (allLines.length === 0) {
      throw new Error('텍스트를 추출할 수 없는 PDF입니다 (스캔 이미지 PDF 등).')
    }
    const bodySize = medianHeight(allLines)

    const blocks: string[] = []
    let paraLines: string[] = []
    let listItems: { ordered: boolean; items: string[] } | null = null

    const flushPara = () => {
      if (paraLines.length === 0) return
      const joined = joinLines(paraLines)
      paraLines = []
      if (joined) blocks.push(`<p>${escapeHtml(joined)}</p>`)
    }

    const flushList = () => {
      if (!listItems || listItems.items.length === 0) {
        listItems = null
        return
      }
      const tag = listItems.ordered ? 'ol' : 'ul'
      blocks.push(`<${tag}>${listItems.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</${tag}>`)
      listItems = null
    }

    pageLines.forEach((lines, pageIndex) => {
      if (pageIndex > 0 && lines.length > 0 && blocks.length > 0) {
        flushPara()
        flushList()
        blocks.push('<hr>')
      }

      let prevLine: TextLine | null = null
      for (const line of lines) {
        const heading = headingLevelFor(line.height, bodySize, line.text)
        if (heading) {
          flushPara()
          flushList()
          blocks.push(`<h${heading}>${escapeHtml(line.text)}</h${heading}>`)
          prevLine = line
          continue
        }

        const bulletMatch = /^[•●◦▪▸\-*]\s+(.+)$/.exec(line.text)
        const numMatch = /^\d+[.)]\s+(.+)$/.exec(line.text)
        if (bulletMatch || numMatch) {
          flushPara()
          const ordered = !!numMatch
          const itemText = (bulletMatch?.[1] ?? numMatch?.[1] ?? '').trim()
          if (listItems && listItems.ordered === ordered) {
            listItems.items.push(itemText)
          } else {
            flushList()
            listItems = { ordered, items: [itemText] }
          }
          prevLine = line
          continue
        }

        flushList()
        if (prevLine) {
          const vGap = prevLine.y - line.y
          if (vGap > Math.max(line.height, prevLine.height) * 1.5) {
            flushPara()
          }
        }
        paraLines.push(line.text)
        prevLine = line
      }
      flushPara()
      flushList()
    })

    return wrapHtmlDocument(blocks.join('\n') || '<p></p>', title)
  } finally {
    await loadingTask.destroy()
  }
}
