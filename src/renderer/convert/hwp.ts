import CFB from 'cfb'
import { inflateSync } from 'fflate'
import { encodeBase64, wrapHtmlDocument, type Align } from './htmlModel'

const HWPTAG_BEGIN = 16
const TAG_BIN_DATA = HWPTAG_BEGIN + 2 // 18
const TAG_CHAR_SHAPE = HWPTAG_BEGIN + 5 // 21
const TAG_PARA_SHAPE = HWPTAG_BEGIN + 9 // 25
const TAG_STYLE = HWPTAG_BEGIN + 10 // 26
const TAG_PARA_HEADER = HWPTAG_BEGIN + 50 // 66
const TAG_PARA_TEXT = HWPTAG_BEGIN + 51 // 67
const TAG_PARA_CHAR_SHAPE = HWPTAG_BEGIN + 52 // 68
const TAG_CTRL_HEADER = HWPTAG_BEGIN + 55 // 71
const TAG_LIST_HEADER = HWPTAG_BEGIN + 56 // 72
const TAG_TABLE = HWPTAG_BEGIN + 61 // 77
const TAG_SHAPE_COMPONENT_PICTURE = HWPTAG_BEGIN + 69 // 85

const EXTENDED_CONTROLS = new Set([1, 2, 3, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23])

interface HwpRecord {
  tagId: number
  level: number
  data: Uint8Array
}

interface CharShape {
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  sub: boolean
  sup: boolean
  sizePt: number
  color?: string
}

interface ParaShape {
  align?: Align
  headingLevel?: number
}

interface StyleInfo {
  name: string
  headingLevel?: number
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function readUtf16Le(bytes: Uint8Array, offset = 0, byteLen = bytes.length - offset): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, Math.max(0, byteLen))
  const codes: number[] = []
  for (let i = 0; i + 1 < view.byteLength; i += 2) {
    codes.push(view.getUint16(i, true))
  }
  return String.fromCharCode(...codes)
}

function maybeInflate(bytes: Uint8Array, compressed: boolean): Uint8Array {
  if (!compressed) return bytes
  try {
    return inflateSync(bytes)
  } catch {
    return bytes
  }
}

function parseRecords(bytes: Uint8Array): HwpRecord[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const records: HwpRecord[] = []
  let offset = 0
  while (offset + 4 <= bytes.length) {
    const header = view.getUint32(offset, true)
    offset += 4
    const tagId = header & 0x3ff
    const level = (header >> 10) & 0x3ff
    let size = (header >> 20) & 0xfff
    if (size === 0xfff) {
      if (offset + 4 > bytes.length) break
      size = view.getUint32(offset, true)
      offset += 4
    }
    if (offset + size > bytes.length) break
    records.push({ tagId, level, data: bytes.subarray(offset, offset + size) })
    offset += size
  }
  return records
}

function parseHeadingName(name: string): number | undefined {
  const ko = /^개요\s*([1-6])$/.exec(name.trim())
  if (ko) return Number(ko[1])
  const en = /^(?:Heading|Outline|Title)\s*([1-6])?$/i.exec(name.trim())
  if (en) return en[1] ? Number(en[1]) : 1
  return undefined
}

function mimeFromExt(ext: string): string {
  const lower = ext.toLowerCase()
  if (lower === 'jpg' || lower === 'jpeg') return 'image/jpeg'
  if (lower === 'gif') return 'image/gif'
  if (lower === 'bmp') return 'image/bmp'
  if (lower === 'webp') return 'image/webp'
  return 'image/png'
}

function parseDocInfo(records: HwpRecord[], cfb: CFB.CFB$Container, compressed: boolean) {
  const charShapes: CharShape[] = []
  const paraShapes: ParaShape[] = []
  const styles: StyleInfo[] = []
  const binData = new Map<number, string>()

  for (const rec of records) {
    const view = new DataView(rec.data.buffer, rec.data.byteOffset, rec.data.byteLength)
    if (rec.tagId === TAG_BIN_DATA && rec.data.length >= 2) {
      const prop = view.getUint16(0, true)
      const type = prop & 0x0f
      const binCompress = (prop >> 4) & 0x03
      if ((type === 1 || type === 2) && rec.data.length >= 6) {
        const binId = view.getUint16(2, true)
        const extLen = view.getUint16(4, true)
        const ext = readUtf16Le(rec.data, 6, extLen * 2).replace(/\0/g, '').toLowerCase()
        const hexId = binId.toString(16).toUpperCase().padStart(4, '0')
        const entryName = `BinData/BIN${hexId}.${ext}`
        const found = CFB.find(cfb, entryName) ?? CFB.find(cfb, `/${entryName}`)
        if (found?.content) {
          const raw = new Uint8Array(found.content as ArrayLike<number>)
          const shouldInflate = binCompress === 1 || (binCompress === 0 && compressed)
          const bytes = maybeInflate(raw, shouldInflate)
          binData.set(binId, `data:${mimeFromExt(ext)};base64,${encodeBase64(bytes)}`)
        }
      }
    } else if (rec.tagId === TAG_CHAR_SHAPE && rec.data.length >= 56) {
      const baseSize = view.getInt32(42, true)
      const attr = view.getUint32(46, true)
      const colorRef = view.getUint32(52, true)
      const r = colorRef & 0xff
      const g = (colorRef >> 8) & 0xff
      const b = (colorRef >> 16) & 0xff
      const hex =
        r === 0 && g === 0 && b === 0
          ? undefined
          : [r, g, b].map((n) => n.toString(16).padStart(2, '0').toUpperCase()).join('')
      charShapes.push({
        italic: (attr & 0x01) !== 0,
        bold: (attr & 0x02) !== 0,
        underline: ((attr >> 2) & 0x03) !== 0,
        sup: ((attr >> 15) & 0x01) !== 0,
        sub: ((attr >> 16) & 0x01) !== 0,
        strike: ((attr >> 18) & 0x07) !== 0,
        sizePt: baseSize > 0 ? baseSize / 100 : 10,
        color: hex,
      })
    } else if (rec.tagId === TAG_PARA_SHAPE && rec.data.length >= 4) {
      const attr1 = view.getUint32(0, true)
      const alignCode = (attr1 >> 2) & 0x07
      const align: Align | undefined =
        alignCode === 3 ? 'center' : alignCode === 2 ? 'right' : alignCode === 0 ? 'justify' : alignCode === 1 ? 'left' : undefined
      const headingType = (attr1 >> 23) & 0x03
      const headingLevelRaw = (attr1 >> 25) & 0x07
      const headingLevel = headingType === 1 && headingLevelRaw <= 5 ? headingLevelRaw + 1 : undefined
      paraShapes.push({ align, headingLevel })
    } else if (rec.tagId === TAG_STYLE && rec.data.length >= 4) {
      const nameLen = view.getUint16(0, true)
      const name = readUtf16Le(rec.data, 2, nameLen * 2)
      const engOffset = 2 + nameLen * 2
      let engName = ''
      if (engOffset + 2 <= rec.data.length) {
        const engLen = view.getUint16(engOffset, true)
        engName = readUtf16Le(rec.data, engOffset + 2, engLen * 2)
      }
      styles.push({
        name,
        headingLevel: parseHeadingName(name) ?? parseHeadingName(engName),
      })
    }
  }
  return { charShapes, paraShapes, styles, binData }
}

function ctrlIdFromBytes(data: Uint8Array): string {
  if (data.length < 4) return ''
  return String.fromCharCode(data[3]!, data[2]!, data[1]!, data[0]!)
}

function extractHyperlinkUrl(data: Uint8Array): string | null {
  const text = readUtf16Le(data, 4)
  const match = /https?:\/\/[^\s;\0"<>]+|mailto:[^\s;\0"<>]+/i.exec(text)
  return match ? match[0] : null
}

function renderParaText(
  paraData: Uint8Array,
  charRuns: Array<{ pos: number; charShapeId: number }>,
  charShapes: CharShape[],
  insideHeading: boolean,
): { html: string; maxSizePt: number; allBold: boolean; hasText: boolean } {
  const view = new DataView(paraData.buffer, paraData.byteOffset, paraData.byteLength)
  const unitCount = Math.floor(paraData.length / 2)
  const runs = charRuns.length > 0 ? charRuns : [{ pos: 0, charShapeId: 0 }]

  const styleAt = (pos: number): CharShape | undefined => {
    let active = runs[0]?.charShapeId ?? 0
    for (const r of runs) {
      if (r.pos <= pos) active = r.charShapeId
      else break
    }
    return charShapes[active]
  }

  let out = ''
  let currentStyle: CharShape | undefined
  let buffer = ''
  let maxSizePt = 0
  let allBold = true
  let hasText = false

  const flush = () => {
    if (!buffer) return
    let chunk = escapeHtml(buffer).replace(/\n/g, '<br>')
    if (currentStyle) {
      if (currentStyle.sub) chunk = `<sub>${chunk}</sub>`
      if (currentStyle.sup) chunk = `<sup>${chunk}</sup>`
      if (currentStyle.strike) chunk = `<del>${chunk}</del>`
      if (currentStyle.underline) chunk = `<u>${chunk}</u>`
      if (currentStyle.italic) chunk = `<em>${chunk}</em>`
      if (currentStyle.bold && !insideHeading) chunk = `<strong>${chunk}</strong>`
      if (currentStyle.color) chunk = `<span style="color:#${currentStyle.color}">${chunk}</span>`
    }
    out += chunk
    buffer = ''
  }

  let i = 0
  while (i < unitCount) {
    const code = view.getUint16(i * 2, true)
    if (EXTENDED_CONTROLS.has(code)) {
      i += 8
      continue
    }
    if (code < 32) {
      if (code === 10) {
        const s = styleAt(i)
        if (s !== currentStyle) { flush(); currentStyle = s }
        buffer += '\n'
      } else if (code === 9) {
        const s = styleAt(i)
        if (s !== currentStyle) { flush(); currentStyle = s }
        buffer += '  '
      } else if (code === 24) {
        buffer += '-'
      } else if (code === 30 || code === 31) {
        buffer += ' '
      }
      i += 1
      continue
    }
    const s = styleAt(i)
    if (s !== currentStyle) {
      flush()
      currentStyle = s
    }
    const ch = String.fromCharCode(code)
    if (ch.trim()) {
      hasText = true
      if (s && s.sizePt > maxSizePt) maxSizePt = s.sizePt
      if (!s?.bold) allBold = false
    }
    buffer += ch
    i += 1
  }
  flush()
  return { html: out, maxSizePt, allBold, hasText }
}

function parseHwpmlXml(xmlText: string, title: string): string {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml')
  const paras: string[] = []
  for (const p of Array.from(doc.getElementsByTagName('P'))) {
    if (p.closest('TABLE')) continue
    const text = Array.from(p.getElementsByTagName('CHAR'))
      .map((c) => c.textContent ?? '')
      .join('')
    if (text.trim()) paras.push(`<p>${escapeHtml(text)}</p>`)
  }
  return wrapHtmlDocument(paras.join('\n') || '<p></p>', title)
}

/** Convert binary HWP 5.0 (or HWPML XML) bytes into clean HTML. */
export async function hwpToHtml(bytes: Uint8Array, title = 'Document'): Promise<string> {
  // Handle HWPML XML saved with .hwp extension if encountered
  const headText = new TextDecoder().decode(bytes.subarray(0, 128)).trimStart()
  if (headText.startsWith('<?xml') || headText.startsWith('<HWPML')) {
    return parseHwpmlXml(new TextDecoder().decode(bytes), title)
  }

  let container: CFB.CFB$Container
  try {
    container = CFB.read(bytes, { type: 'array' })
  } catch {
    throw new Error('지원되지 않는 HWP 파일 형식입니다 (HWP 5.0 이상만 지원).')
  }

  const fileHeader = CFB.find(container, 'FileHeader') ?? CFB.find(container, '/FileHeader')
  if (!fileHeader?.content) {
    throw new Error('HWP FileHeader를 찾을 수 없습니다.')
  }
  const fh = new Uint8Array(fileHeader.content as ArrayLike<number>)
  const sig = new TextDecoder('ascii').decode(fh.subarray(0, 17))
  if (!sig.startsWith('HWP Document File')) {
    throw new Error('유효한 HWP 문서가 아닙니다.')
  }
  const flags = fh.length >= 40 ? new DataView(fh.buffer, fh.byteOffset, fh.byteLength).getUint32(36, true) : 0
  const compressed = (flags & 0x01) !== 0
  const encrypted = (flags & 0x02) !== 0
  const distributed = (flags & 0x04) !== 0
  if (encrypted) {
    throw new Error('암호로 보호된 HWP 문서는 가져올 수 없습니다.')
  }

  const docInfoEntry = CFB.find(container, 'DocInfo') ?? CFB.find(container, '/DocInfo')
  const docInfoRecords = docInfoEntry?.content
    ? parseRecords(maybeInflate(new Uint8Array(docInfoEntry.content as ArrayLike<number>), compressed))
    : []
  const docInfo = parseDocInfo(docInfoRecords, container, compressed)

  const sectionEntries = container.FileIndex
    .filter((entry) => /^\/?BodyText\/Section\d+$/i.test(entry.name) || /^Section\d+$/i.test(entry.name))
    .filter((entry) => entry.type === 2 && entry.content)
    .sort((a, b) => {
      const na = Number(/Section(\d+)$/i.exec(a.name)?.[1] ?? '0')
      const nb = Number(/Section(\d+)$/i.exec(b.name)?.[1] ?? '0')
      return na - nb
    })

  if (sectionEntries.length === 0) {
    if (distributed) {
      throw new Error('배포용(ViewText) 암호화 HWP 문서는 가져올 수 없습니다.')
    }
    const prvEntry = CFB.find(container, 'PrvText') ?? CFB.find(container, '/PrvText')
    if (prvEntry?.content) {
      const prvBytes = new Uint8Array(prvEntry.content as ArrayLike<number>)
      const text = readUtf16Le(prvBytes).replace(/\0/g, '').trim()
      const html = text ? text.split(/\r?\n/).map((l) => `<p>${escapeHtml(l)}</p>`).join('\n') : '<p></p>'
      return wrapHtmlDocument(html, title)
    }
    throw new Error('HWP 본문 섹션을 찾을 수 없습니다.')
  }

  const renderSectionRecords = (records: HwpRecord[]): string[] => {
    const blocks: string[] = []
    let idx = 0

    const readParagraphAt = (startIdx: number, minLevel: number): { html: string; nextIdx: number } => {
      const headerRec = records[startIdx]!
      const hView = new DataView(headerRec.data.buffer, headerRec.data.byteOffset, headerRec.data.byteLength)
      const paraShapeId = headerRec.data.length >= 10 ? hView.getUint16(8, true) : 0
      const styleId = headerRec.data.length >= 11 ? headerRec.data[10]! : 0
      const paraShape = docInfo.paraShapes[paraShapeId]
      const styleInfo = docInfo.styles[styleId]

      let paraTextData: Uint8Array | null = null
      const charRuns: Array<{ pos: number; charShapeId: number }> = []
      const embeddedHtml: string[] = []
      let linkUrl: string | null = null

      let j = startIdx + 1
      while (j < records.length && records[j]!.level > minLevel) {
        const rec = records[j]!
        if (rec.level === minLevel + 1) {
          if (rec.tagId === TAG_PARA_TEXT) {
            paraTextData = rec.data
          } else if (rec.tagId === TAG_PARA_CHAR_SHAPE) {
            const cView = new DataView(rec.data.buffer, rec.data.byteOffset, rec.data.byteLength)
            for (let k = 0; k + 8 <= rec.data.length; k += 8) {
              charRuns.push({ pos: cView.getUint32(k, true), charShapeId: cView.getUint32(k + 4, true) })
            }
          } else if (rec.tagId === TAG_CTRL_HEADER) {
            const ctrlId = ctrlIdFromBytes(rec.data)
            if (ctrlId === '%hlk') {
              linkUrl = extractHyperlinkUrl(rec.data)
            } else if (ctrlId === 'tbl ') {
              const parsedTable = readTableAt(j + 1, minLevel + 2)
              if (parsedTable.html) embeddedHtml.push(parsedTable.html)
              j = parsedTable.nextIdx
              continue
            } else if (ctrlId === 'gso ') {
              const pic = readPictureAt(j + 1, minLevel + 1)
              if (pic) embeddedHtml.push(pic)
            }
          }
        }
        j++
      }

      let headingLevel = paraShape?.headingLevel ?? styleInfo?.headingLevel
      let textHtml = ''
      if (paraTextData) {
        let rendered = renderParaText(paraTextData, charRuns, docInfo.charShapes, !!headingLevel)
        if (!headingLevel && rendered.hasText && rendered.allBold && rendered.maxSizePt >= 14) {
          headingLevel = rendered.maxSizePt >= 20 ? 1 : rendered.maxSizePt >= 16 ? 2 : 3
          rendered = renderParaText(paraTextData, charRuns, docInfo.charShapes, true)
        }
        textHtml = rendered.html
        if (linkUrl && textHtml && !/^(?:javascript|vbscript):/i.test(linkUrl)) {
          textHtml = `<a href="${escapeHtml(linkUrl)}">${textHtml}</a>`
        }
      }

      const alignAttr = paraShape?.align && paraShape.align !== 'left' ? ` style="text-align:${paraShape.align}"` : ''
      const outBlocks: string[] = []
      const inlinePictures = embeddedHtml.filter((chunk) => !chunk.startsWith('<table'))
      const tables = embeddedHtml.filter((chunk) => chunk.startsWith('<table'))
      const inlineCombined = [textHtml, ...inlinePictures].filter(Boolean).join('')
      if (inlineCombined) {
        if (headingLevel && headingLevel >= 1 && headingLevel <= 6) {
          outBlocks.push(`<h${headingLevel}${alignAttr}>${inlineCombined}</h${headingLevel}>`)
        } else {
          outBlocks.push(`<p${alignAttr}>${inlineCombined}</p>`)
        }
      }
      outBlocks.push(...tables)
      return { html: outBlocks.join('\n'), nextIdx: j }
    }

    const readPictureAt = (startIdx: number, ctrlLevel: number): string | null => {
      let k = startIdx
      while (k < records.length && records[k]!.level > ctrlLevel) {
        const rec = records[k]!
        if (rec.tagId === TAG_SHAPE_COMPONENT_PICTURE && rec.data.length >= 75) {
          const view = new DataView(rec.data.buffer, rec.data.byteOffset, rec.data.byteLength)
          // HWP5 pictureInfo stores binItemId at offset 73 (after 71 bytes geometry + 3 bytes attr? try both 71 and 73 safely)
          for (const off of [71, 73]) {
            if (off + 2 <= rec.data.length) {
              const binId = view.getUint16(off, true)
              const src = docInfo.binData.get(binId)
              if (src) return `<img src="${src}" alt="">`
            }
          }
        }
        k++
      }
      return null
    }

    const readTableAt = (startIdx: number, tableLevel: number): { html: string; nextIdx: number } => {
      let k = startIdx
      let rowCount = 0
      let colCount = 0
      const cells: Array<{ row: number; col: number; rowSpan: number; colSpan: number; html: string }> = []

      while (k < records.length && records[k]!.level >= tableLevel) {
        const rec = records[k]!
        if (rec.level === tableLevel && rec.tagId === TAG_TABLE && rec.data.length >= 8) {
          const tView = new DataView(rec.data.buffer, rec.data.byteOffset, rec.data.byteLength)
          rowCount = tView.getUint16(4, true)
          colCount = tView.getUint16(6, true)
          k++
          continue
        }
        if (rec.level === tableLevel && rec.tagId === TAG_LIST_HEADER && rec.data.length >= 14) {
          const lView = new DataView(rec.data.buffer, rec.data.byteOffset, rec.data.byteLength)
          // Standard HWP5 cell LIST_HEADER is 6 bytes + 26-byte cell property (= 32); some variants include 2 padding bytes (= 34+)
          const base = rec.data.length === 32 ? 6 : 8
          const col = lView.getUint16(base, true)
          const row = lView.getUint16(base + 2, true)
          const colSpan = Math.max(1, lView.getUint16(base + 4, true))
          const rowSpan = Math.max(1, lView.getUint16(base + 6, true))
          k++
          const cellHtml: string[] = []
          while (k < records.length && records[k]!.level > tableLevel) {
            if (records[k]!.level === tableLevel + 1 && records[k]!.tagId === TAG_PARA_HEADER) {
              const para = readParagraphAt(k, tableLevel + 1)
              if (para.html) cellHtml.push(para.html)
              k = para.nextIdx
            } else {
              k++
            }
          }
          cells.push({ row, col, rowSpan, colSpan, html: cellHtml.join('') || '<p></p>' })
          continue
        }
        k++
      }

      if (cells.length === 0 || rowCount === 0) return { html: '', nextIdx: k }
      const rowMap = new Map<number, typeof cells>()
      for (const c of cells) {
        const arr = rowMap.get(c.row) ?? []
        arr.push(c)
        rowMap.set(c.row, arr)
      }
      const rowsHtml: string[] = []
      for (let r = 0; r < rowCount; r++) {
        const rowCells = (rowMap.get(r) ?? []).sort((a, b) => a.col - b.col)
        if (rowCells.length === 0 && colCount > 0) continue
        const tds = rowCells
          .map((c) => `<td${c.colSpan > 1 ? ` colspan="${c.colSpan}"` : ''}${c.rowSpan > 1 ? ` rowspan="${c.rowSpan}"` : ''}>${c.html}</td>`)
          .join('')
        rowsHtml.push(`<tr>${tds}</tr>`)
      }
      return { html: `<table>${rowsHtml.join('')}</table>`, nextIdx: k }
    }

    while (idx < records.length) {
      const rec = records[idx]!
      if (rec.level === 0 && rec.tagId === TAG_PARA_HEADER) {
        const para = readParagraphAt(idx, 0)
        if (para.html) blocks.push(para.html)
        idx = para.nextIdx
      } else {
        idx++
      }
    }
    return blocks
  }

  const allBlocks: string[] = []
  for (const entry of sectionEntries) {
    const raw = new Uint8Array(entry.content as ArrayLike<number>)
    const inflated = maybeInflate(raw, compressed)
    const records = parseRecords(inflated)
    allBlocks.push(...renderSectionRecords(records))
  }

  if (allBlocks.length === 0) {
    const prvEntry = CFB.find(container, 'PrvText') ?? CFB.find(container, '/PrvText')
    if (prvEntry?.content) {
      const prvBytes = new Uint8Array(prvEntry.content as ArrayLike<number>)
      const text = readUtf16Le(prvBytes).replace(/\0/g, '').trim()
      if (text) {
        return wrapHtmlDocument(text.split(/\r?\n/).map((l) => `<p>${escapeHtml(l)}</p>`).join('\n'), title)
      }
    }
  }

  return wrapHtmlDocument(allBlocks.join('\n') || '<p></p>', title)
}
