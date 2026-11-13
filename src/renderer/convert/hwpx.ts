import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { encodeBase64, escapeXml, normalizeHexColor, parseHtmlToDocument, wrapHtmlDocument, type Align, type BlockNode, type ImageData, type InlineSegment, type InlineStyle } from './htmlModel'

interface CharProp {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  sub?: boolean
  sup?: boolean
  heightPt?: number
  color?: string
}

interface ParaProp {
  align?: Align
  headingLevel?: number
}

interface StyleProp {
  name: string
  paraPrId?: string
  charPrId?: string
  headingLevel?: number
}

function parseXml(xmlText: string): Document {
  return new DOMParser().parseFromString(xmlText, 'application/xml')
}

function childrenByLocal(el: Element, localName: string): Element[] {
  const out: Element[] = []
  for (const child of Array.from(el.children)) {
    if (child.localName === localName) out.push(child)
  }
  return out
}

function firstByLocal(el: Element, localName: string): Element | undefined {
  for (const child of Array.from(el.children)) {
    if (child.localName === localName) return child
  }
  return undefined
}

function findDescendantByLocal(el: Element, localName: string): Element | undefined {
  for (const node of Array.from(el.getElementsByTagName('*'))) {
    if (node.localName === localName) return node
  }
  return undefined
}

function mimeFromHref(href: string): string {
  const lower = href.toLowerCase()
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.bmp')) return 'image/bmp'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  return 'image/png'
}

function parseHeadingName(name: string): number | undefined {
  const ko = /^개요\s*([1-6])$/.exec(name.trim())
  if (ko) return Number(ko[1])
  const en = /^(?:Heading|Title)\s*([1-6])?$/i.exec(name.trim())
  if (en) return en[1] ? Number(en[1]) : 1
  return undefined
}

function parseHeaderXml(xmlText: string): {
  chars: Map<string, CharProp>
  paras: Map<string, ParaProp>
  styles: Map<string, StyleProp>
} {
  const doc = parseXml(xmlText)
  const chars = new Map<string, CharProp>()
  const paras = new Map<string, ParaProp>()
  const styles = new Map<string, StyleProp>()

  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    if (el.localName === 'charPr') {
      const id = el.getAttribute('id')
      if (!id) continue
      const heightRaw = Number(el.getAttribute('height') ?? '1000')
      const colorRaw = el.getAttribute('textColor')
      const color = colorRaw && colorRaw !== '#000000' && colorRaw !== 'none' ? normalizeHexColor(colorRaw) : undefined
      const bold = !!firstByLocal(el, 'bold')
      const italic = !!firstByLocal(el, 'italic')
      const ul = firstByLocal(el, 'underline')
      const underline = !!ul && ul.getAttribute('type') !== 'NONE'
      const st = firstByLocal(el, 'strikeout')
      const strike = !!st && st.getAttribute('shape') !== 'NONE'
      const supscript = !!firstByLocal(el, 'supscript')
      const subscript = !!firstByLocal(el, 'subscript')
      chars.set(id, {
        bold,
        italic,
        underline,
        strike,
        sup: supscript,
        sub: subscript,
        heightPt: Number.isFinite(heightRaw) ? heightRaw / 100 : 10,
        color,
      })
    } else if (el.localName === 'paraPr') {
      const id = el.getAttribute('id')
      if (!id) continue
      const alignEl = firstByLocal(el, 'align')
      const horiz = alignEl?.getAttribute('horizontal')?.toUpperCase()
      const align: Align | undefined =
        horiz === 'CENTER' ? 'center' : horiz === 'RIGHT' ? 'right' : horiz === 'JUSTIFY' ? 'justify' : horiz === 'LEFT' ? 'left' : undefined
      const headingEl = firstByLocal(el, 'heading')
      let headingLevel: number | undefined
      if (headingEl?.getAttribute('type') === 'OUTLINE') {
        const lvl = Number(headingEl.getAttribute('level') ?? '0')
        if (lvl >= 0 && lvl <= 5) headingLevel = lvl + 1
      }
      paras.set(id, { align, headingLevel })
    } else if (el.localName === 'style') {
      const id = el.getAttribute('id')
      if (!id) continue
      const name = el.getAttribute('name') ?? el.getAttribute('engName') ?? ''
      const headingLevel = parseHeadingName(name) ?? parseHeadingName(el.getAttribute('engName') ?? '')
      styles.set(id, {
        name,
        paraPrId: el.getAttribute('paraPrIDRef') ?? undefined,
        charPrId: el.getAttribute('charPrIDRef') ?? undefined,
        headingLevel,
      })
    }
  }
  return { chars, paras, styles }
}

function parseBinDataMap(files: Record<string, Uint8Array>): Map<string, string> {
  const map = new Map<string, string>()
  const hpfEntry = Object.entries(files).find(([name]) => /(^|\/)content\.hpf$/i.test(name))
  if (hpfEntry) {
    const doc = parseXml(strFromU8(hpfEntry[1]))
    for (const item of Array.from(doc.getElementsByTagName('*'))) {
      if (item.localName !== 'item') continue
      const id = item.getAttribute('id')
      const href = item.getAttribute('href')
      if (!id || !href) continue
      const candidate = files[href] ?? files[`Contents/${href}`] ?? files[href.replace(/^\/+/, '')]
      if (!candidate) continue
      const mime = item.getAttribute('media-type') || mimeFromHref(href)
      map.set(id, `data:${mime};base64,${encodeBase64(candidate)}`)
    }
  }
  for (const [name, bytes] of Object.entries(files)) {
    const m = /(?:^|\/)BinData\/([^/]+)$/i.exec(name)
    if (!m) continue
    const file = m[1]!
    const stem = file.replace(/\.[^.]+$/, '')
    const dataUrl = `data:${mimeFromHref(file)};base64,${encodeBase64(bytes)}`
    if (!map.has(stem)) map.set(stem, dataUrl)
    if (!map.has(file)) map.set(file, dataUrl)
  }
  return map
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function wrapStyledHtml(text: string, prop?: CharProp, insideHeading = false): string {
  let out = escapeHtml(text)
  if (!prop) return out
  if (prop.sub) out = `<sub>${out}</sub>`
  if (prop.sup) out = `<sup>${out}</sup>`
  if (prop.strike) out = `<del>${out}</del>`
  if (prop.underline) out = `<u>${out}</u>`
  if (prop.italic) out = `<em>${out}</em>`
  if (prop.bold && !insideHeading) out = `<strong>${out}</strong>`
  if (prop.color) out = `<span style="color:#${prop.color}">${out}</span>`
  return out
}

/** Convert HWPX (KS X 6101 OWPML) bytes into clean HTML. */
export async function hwpxToHtml(bytes: Uint8Array, title = 'Document'): Promise<string> {
  const files = unzipSync(bytes)
  const headerEntry = Object.entries(files).find(([name]) => /(^|\/)header\.xml$/i.test(name))
  const header = headerEntry
    ? parseHeaderXml(strFromU8(headerEntry[1]))
    : { chars: new Map<string, CharProp>(), paras: new Map<string, ParaProp>(), styles: new Map<string, StyleProp>() }
  const binData = parseBinDataMap(files)

  const sectionEntries = Object.entries(files)
    .filter(([name]) => /(^|\/)section\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const na = Number(/section(\d+)\.xml$/i.exec(a[0])?.[1] ?? '0')
      const nb = Number(/section(\d+)\.xml$/i.exec(b[0])?.[1] ?? '0')
      return na - nb
    })

  if (sectionEntries.length === 0) {
    const prv = Object.entries(files).find(([name]) => /(^|\/)PrvText\.txt$/i.test(name))
    if (prv) {
      const text = strFromU8(prv[1]).trim()
      const html = text ? text.split(/\r?\n/).map((line) => `<p>${escapeHtml(line)}</p>`).join('\n') : '<p></p>'
      return wrapHtmlDocument(html, title)
    }
    throw new Error('유효한 HWPX 본문 섹션을 찾을 수 없습니다.')
  }

  const renderPara = (pEl: Element): string => {
    const paraPrId = pEl.getAttribute('paraPrIDRef') ?? ''
    const styleId = pEl.getAttribute('styleIDRef') ?? ''
    const paraProp = header.paras.get(paraPrId)
    const styleProp = header.styles.get(styleId)
    let headingLevel = paraProp?.headingLevel ?? styleProp?.headingLevel

    const parts: string[] = []
    let activeHref: string | null = null
    let maxHeightPt = 0
    let allBold = true
    let hasText = false

    const runs = childrenByLocal(pEl, 'run')
    for (const run of runs) {
      const charPr = header.chars.get(run.getAttribute('charPrIDRef') ?? '')
      for (const node of Array.from(run.children)) {
        const tag = node.localName
        if (tag === 'ctrl') {
          const fieldBegin = findDescendantByLocal(node, 'fieldBegin')
          if (fieldBegin && fieldBegin.getAttribute('type') === 'HYPERLINK') {
            const pathParam = Array.from(fieldBegin.getElementsByTagName('*')).find(
              (el) => el.localName === 'stringParam' && el.getAttribute('name') === 'Path',
            )
            const href = pathParam?.textContent?.trim()
            if (href && !/^(?:javascript|vbscript):/i.test(href)) activeHref = href
          }
          const fieldEnd = findDescendantByLocal(node, 'fieldEnd')
          if (fieldEnd) activeHref = null
        } else if (tag === 't') {
          let inner = ''
          for (const child of Array.from(node.childNodes)) {
            if (child.nodeType === 3) {
              inner += child.textContent ?? ''
            } else if (child.nodeType === 1) {
              const cTag = (child as Element).localName
              if (cTag === 'lineBreak') inner += '\n'
              else if (cTag === 'tab') inner += '\t'
              else if (cTag === 'nbSpace' || cTag === 'fwSpace') inner += ' '
              else inner += child.textContent ?? ''
            }
          }
          if (inner.trim()) {
            hasText = true
            if (charPr?.heightPt && charPr.heightPt > maxHeightPt) maxHeightPt = charPr.heightPt
            if (!charPr?.bold) allBold = false
          }
          const styled = wrapStyledHtml(inner, charPr, !!headingLevel).replace(/\n/g, '<br>')
          if (styled) {
            parts.push(activeHref ? `<a href="${escapeHtml(activeHref)}">${styled}</a>` : styled)
          }
        } else if (tag === 'tbl') {
          parts.push(renderTable(node))
        } else if (tag === 'pic') {
          const img = findDescendantByLocal(node, 'img')
          const ref = img?.getAttribute('binaryItemIDRef') ?? ''
          const src = binData.get(ref)
          if (src) parts.push(`<img src="${src}" alt="">`)
        }
      }
    }

    const joined = parts.join('')
    if (parts.length === 1 && joined.startsWith('<table')) return joined
    if (!joined.trim() && runs.length <= 1) return ''

    if (!headingLevel && hasText && allBold && maxHeightPt >= 14) {
      headingLevel = maxHeightPt >= 20 ? 1 : maxHeightPt >= 16 ? 2 : 3
    }
    const alignAttr = paraProp?.align && paraProp.align !== 'left' ? ` style="text-align:${paraProp.align}"` : ''
    if (headingLevel && headingLevel >= 1 && headingLevel <= 6) {
      return `<h${headingLevel}${alignAttr}>${joined}</h${headingLevel}>`
    }
    return `<p${alignAttr}>${joined}</p>`
  }

  const renderTable = (tblEl: Element): string => {
    const rowsHtml: string[] = []
    for (const tr of childrenByLocal(tblEl, 'tr')) {
      const cellsHtml: string[] = []
      for (const tc of childrenByLocal(tr, 'tc')) {
        const span = firstByLocal(tc, 'cellSpan')
        const colSpan = Number(span?.getAttribute('colSpan') ?? '1') || 1
        const rowSpan = Number(span?.getAttribute('rowSpan') ?? '1') || 1
        const subList = firstByLocal(tc, 'subList')
        const cellParas = subList ? childrenByLocal(subList, 'p').map(renderPara).filter(Boolean).join('') : ''
        const attrs = `${colSpan > 1 ? ` colspan="${colSpan}"` : ''}${rowSpan > 1 ? ` rowspan="${rowSpan}"` : ''}`
        cellsHtml.push(`<td${attrs}>${cellParas || '<p></p>'}</td>`)
      }
      if (cellsHtml.length > 0) rowsHtml.push(`<tr>${cellsHtml.join('')}</tr>`)
    }
    return `<table>${rowsHtml.join('')}</table>`
  }

  const outBlocks: string[] = []
  for (const [, secBytes] of sectionEntries) {
    const secDoc = parseXml(strFromU8(secBytes))
    const root = secDoc.documentElement
    for (const p of childrenByLocal(root, 'p')) {
      const rendered = renderPara(p)
      if (rendered) outBlocks.push(rendered)
    }
  }
  return wrapHtmlDocument(outBlocks.join('\n') || '<p></p>', title)
}

// ---- HWPX Export ----

interface ExportImageEntry {
  id: string
  href: string
  mime: string
  data: ImageData
}

function hwpxAlign(align?: Align): string {
  if (align === 'center') return 'CENTER'
  if (align === 'right') return 'RIGHT'
  if (align === 'justify') return 'JUSTIFY'
  return 'LEFT'
}

/** Convert an HTML document into OWPML HWPX binary bytes. */
export async function htmlToHwpx(html: string, fallbackTitle = 'Document'): Promise<Uint8Array> {
  const parsed = await parseHtmlToDocument(html, fallbackTitle)

  const charMap = new Map<string, { id: number; style: InlineStyle; height: number; monospace: boolean }>()
  const charList: Array<{ id: number; style: InlineStyle; height: number; monospace: boolean }> = []
  const getCharId = (style: InlineStyle, height = 1000, monospace = false): number => {
    const key = JSON.stringify({
      b: !!style.bold,
      i: !!style.italic,
      u: !!(style.underline || style.link),
      s: !!style.strike,
      sub: !!style.sub,
      sup: !!style.sup,
      c: style.color ?? (style.link ? '0A69DA' : ''),
      h: height,
      m: monospace || !!style.code,
    })
    const existing = charMap.get(key)
    if (existing) return existing.id
    const item = { id: charList.length, style: { ...style }, height, monospace: monospace || !!style.code }
    charMap.set(key, item)
    charList.push(item)
    return item.id
  }
  // Ensure default charPr id=0 exists
  getCharId({}, 1000, false)

  const paraMap = new Map<string, { id: number; align: Align; indent: number; borderFill: number; headingLevel?: number }>()
  const paraList: Array<{ id: number; align: Align; indent: number; borderFill: number; headingLevel?: number }> = []
  const getParaId = (align: Align = 'left', indent = 0, borderFill = 2, headingLevel?: number): number => {
    const key = `${align}|${indent}|${borderFill}|${headingLevel ?? 0}`
    const existing = paraMap.get(key)
    if (existing) return existing.id
    const item = { id: paraList.length, align, indent, borderFill, headingLevel }
    paraMap.set(key, item)
    paraList.push(item)
    return item.id
  }
  getParaId('left', 0, 2)

  const images: ExportImageEntry[] = []
  const prvLines: string[] = []
  let nextItemId = 1

  const registerImage = (data: ImageData): ExportImageEntry => {
    const idx = images.length + 1
    const id = `bin${idx}`
    const entry: ExportImageEntry = { id, href: `BinData/image${idx}.${data.ext}`, mime: data.mime, data }
    images.push(entry)
    return entry
  }

  const renderRunsXml = (segments: InlineSegment[], baseHeight: number, baseBold = false): string => {
    if (segments.length === 0) {
      const charId = getCharId({ bold: baseBold }, baseHeight)
      return `<hp:run charPrIDRef="${charId}"><hp:t/></hp:run>`
    }
    const xml: string[] = []
    for (const seg of segments) {
      if (seg.type === 'break') {
        const charId = getCharId({ bold: baseBold }, baseHeight)
        xml.push(`<hp:run charPrIDRef="${charId}"><hp:t><hp:lineBreak/></hp:t></hp:run>`)
        continue
      }
      if (seg.type === 'image') {
        if (seg.image) {
          const img = registerImage(seg.image)
          const pxToHwp = 75 // 1px ≈ 75 HWPUNIT (1/7200 inch at 96dpi)
          const maxW = 42500
          const rawW = Math.max(1200, seg.image.width * pxToHwp)
          const rawH = Math.max(1200, seg.image.height * pxToHwp)
          const scale = rawW > maxW ? maxW / rawW : 1
          const w = Math.round(rawW * scale)
          const h = Math.round(rawH * scale)
          const picId = nextItemId++
          xml.push(
            `<hp:run charPrIDRef="0"><hp:pic id="${picId}" zOrder="0" numberingType="PICTURE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="${picId}" reverse="0"><hp:offset x="0" y="0"/><hp:orgSz width="${w}" height="${h}"/><hp:curSz width="${w}" height="${h}"/><hp:flip horizontal="0" vertical="0"/><hp:rotationInfo angle="0" centerX="${Math.round(w / 2)}" centerY="${Math.round(h / 2)}" rotateimage="1"/><hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo><hc:img binaryItemIDRef="${img.id}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/><hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="${w}" y="0"/><hc:pt2 x="${w}" y="${h}"/><hc:pt3 x="0" y="${h}"/></hp:imgRect><hp:imgClip left="0" right="${w}" top="0" bottom="${h}"/><hp:inMargin left="0" right="0" top="0" bottom="0"/><hp:imgDim dimwidth="${w}" dimheight="${h}"/><hp:effects/><hp:sz width="${w}" height="${h}" widthRelTo="ABSOLUTE" heightRelTo="ABSOLUTE" protect="0"/><hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="0" right="0" top="0" bottom="0"/></hp:pic><hp:t/></hp:run>`,
          )
        } else if (seg.alt) {
          const charId = getCharId({ italic: true, color: '666666' }, baseHeight)
          xml.push(`<hp:run charPrIDRef="${charId}"><hp:t>${escapeXml(`[${seg.alt}]`)}</hp:t></hp:run>`)
          prvLines.push(`[${seg.alt}]`)
        }
        continue
      }
      prvLines.push(seg.text)
      const style: InlineStyle = { ...seg.style, bold: seg.style.bold || baseBold }
      const charId = getCharId(style, baseHeight)
      if (style.link) {
        const fieldId = nextItemId++
        xml.push(
          `<hp:run charPrIDRef="${charId}"><hp:ctrl><hp:fieldBegin id="${fieldId}" type="HYPERLINK" name="" editable="0" dirty="1" zorder="-1" fieldid="${fieldId}" metaTag=""><hp:parameters cnt="5" name=""><hp:integerParam name="Prop">0</hp:integerParam><hp:stringParam name="Command">${escapeXml(style.link)};1;0;0;</hp:stringParam><hp:stringParam name="Path">${escapeXml(style.link)}</hp:stringParam><hp:stringParam name="Category">HWPLink</hp:stringParam><hp:stringParam name="TargetType">URL</hp:stringParam></hp:parameters></hp:fieldBegin></hp:ctrl><hp:t>${escapeXml(seg.text)}</hp:t><hp:ctrl><hp:fieldEnd beginIDRef="${fieldId}" fieldid="${fieldId}"/></hp:ctrl></hp:run>`,
        )
      } else {
        xml.push(`<hp:run charPrIDRef="${charId}"><hp:t>${escapeXml(seg.text)}</hp:t></hp:run>`)
      }
    }
    return xml.join('')
  }

  const renderBlocksXml = (blocks: BlockNode[], withSecPr = false): string => {
    const out: string[] = []
    const secPrXml = withSecPr
      ? `<hp:run charPrIDRef="0"><hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000" tabStopVal="4000" tabStopUnit="HWPUNIT" outlineShapeIDRef="1" memoShapeIDRef="0" textVerticalWidthHead="0" masterPageCnt="0"><hp:grid lineGrid="0" charGrid="0" wongogojiFormat="0"/><hp:startNum pageStartsOn="BOTH" page="0" pic="0" tbl="0" equation="0"/><hp:visibility hideFirstHeader="0" hideFirstFooter="0" hideFirstMasterPage="0" border="SHOW_ALL" fill="SHOW_ALL" hideFirstPageNum="0" hideFirstEmptyLine="0" showLineNumber="0"/><hp:lineNumberShape restartType="0" countBy="0" distance="0" startNumber="0"/><hp:pagePr landscape="WIDELY" width="59528" height="84188" gutterType="LEFT_ONLY"><hp:margin header="4252" footer="4252" gutter="0" left="8504" right="8504" top="5668" bottom="4252"/></hp:pagePr><hp:footNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/><hp:noteLine length="-1" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="283" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="EACH_COLUMN" beneathText="0"/></hp:footNotePr><hp:endNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/><hp:noteLine length="14692344" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="0" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="END_OF_DOCUMENT" beneathText="0"/></hp:endNotePr><hp:pageBorderFill type="BOTH" borderFillIDRef="1" textBorder="PAPER" headerInside="0" footerInside="0" fillArea="PAPER"><hp:offset left="1417" right="1417" top="1417" bottom="1417"/></hp:pageBorderFill></hp:secPr><hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"/></hp:ctrl></hp:run>`
      : ''

    blocks.forEach((block, idx) => {
      const prefixRun = idx === 0 ? secPrXml : ''
      if (block.type === 'heading') {
        const sizes = { 1: 2000, 2: 1600, 3: 1350, 4: 1150, 5: 1050, 6: 1000 } as const
        const paraId = getParaId(block.align ?? 'left', 0, 2, block.level)
        const pid = nextItemId++
        out.push(
          `<hp:p id="${pid}" paraPrIDRef="${paraId}" styleIDRef="${block.level}" pageBreak="0" columnBreak="0" merged="0">${prefixRun}${renderRunsXml(block.runs, sizes[block.level], true)}</hp:p>`,
        )
        prvLines.push('\n')
        return
      }
      if (block.type === 'paragraph') {
        const indent = block.quote ? 800 : block.list ? (block.list.level + 1) * 600 : 0
        const borderFill = block.quote ? 4 : 2
        const paraId = getParaId(block.align ?? 'left', indent, borderFill)
        const pid = nextItemId++
        const runs = block.list
          ? [{ type: 'text' as const, text: block.list.ordered ? `${block.list.index ?? 1}. ` : '• ', style: {} }, ...block.runs]
          : block.runs
        out.push(
          `<hp:p id="${pid}" paraPrIDRef="${paraId}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${prefixRun}${renderRunsXml(runs, 1000)}</hp:p>`,
        )
        prvLines.push('\n')
        return
      }
      if (block.type === 'code') {
        const paraId = getParaId('left', 400, 5)
        const pid = nextItemId++
        const lines = block.text.split('\n')
        const runs: InlineSegment[] = []
        lines.forEach((line, li) => {
          if (li > 0) runs.push({ type: 'break' })
          runs.push({ type: 'text', text: line, style: { code: true } })
        })
        out.push(
          `<hp:p id="${pid}" paraPrIDRef="${paraId}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${prefixRun}${renderRunsXml(runs, 950)}</hp:p>`,
        )
        prvLines.push('\n')
        return
      }
      if (block.type === 'hr') {
        const paraId = getParaId('left', 0, 6)
        const pid = nextItemId++
        out.push(`<hp:p id="${pid}" paraPrIDRef="${paraId}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${prefixRun}<hp:run charPrIDRef="0"><hp:t/></hp:run></hp:p>`)
        return
      }
      if (block.type === 'table') {
        const rowCnt = block.rows.length
        const colCnt = Math.max(1, ...block.rows.map((r) => r.reduce((s, c) => s + c.colSpan, 0)))
        const totalWidth = 42520
        const colWidth = Math.floor(totalWidth / colCnt)
        const tblId = nextItemId++
        const pid = nextItemId++
        const occupied = new Set<string>()
        const trXml: string[] = []
        block.rows.forEach((row, rIdx) => {
          const tcXml: string[] = []
          let cIdx = 0
          for (const cell of row) {
            while (occupied.has(`${rIdx}:${cIdx}`)) cIdx++
            for (let dr = 0; dr < cell.rowSpan; dr++) {
              for (let dc = 0; dc < cell.colSpan; dc++) occupied.add(`${rIdx + dr}:${cIdx + dc}`)
            }
            const cellXml = renderBlocksXml(cell.blocks, false) || `<hp:p id="${nextItemId++}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0"><hp:t/></hp:run></hp:p>`
            const cellW = colWidth * cell.colSpan
            const bf = cell.header ? 3 : 2
            tcXml.push(
              `<hp:tc name="" header="${cell.header ? 1 : 0}" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="${bf}"><hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">${cellXml}</hp:subList><hp:cellAddr colAddr="${cIdx}" rowAddr="${rIdx}"/><hp:cellSpan colSpan="${cell.colSpan}" rowSpan="${cell.rowSpan}"/><hp:cellSz width="${cellW}" height="2400"/><hp:cellMargin left="510" right="510" top="141" bottom="141"/></hp:tc>`,
            )
            cIdx += cell.colSpan
          }
          trXml.push(`<hp:tr>${tcXml.join('')}</hp:tr>`)
        })
        out.push(
          `<hp:p id="${pid}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${prefixRun}<hp:run charPrIDRef="0"><hp:tbl id="${tblId}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="1" rowCnt="${rowCnt}" colCnt="${colCnt}" cellSpacing="0" borderFillIDRef="2" noAdjust="0"><hp:sz width="${totalWidth}" height="${rowCnt * 2400}" widthRelTo="ABSOLUTE" heightRelTo="ABSOLUTE" protect="0"/><hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="283" right="283" top="283" bottom="283"/><hp:inMargin left="510" right="510" top="141" bottom="141"/>${trXml.join('')}</hp:tbl><hp:t/></hp:run></hp:p>`,
        )
      }
    })

    if (out.length === 0 && withSecPr) {
      out.push(`<hp:p id="${nextItemId++}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${secPrXml}<hp:run charPrIDRef="0"><hp:t/></hp:run></hp:p>`)
    }
    return out.join('')
  }

  const sectionBodyXml = renderBlocksXml(parsed.blocks, true)

  const charPropsXml = charList
    .map((c) => {
      const fontId = c.monospace ? 1 : 0
      const color = c.style.color ? `#${c.style.color}` : c.style.link ? '#0A69DA' : '#000000'
      const shade = c.style.highlight ? `#${c.style.highlight}` : c.monospace ? '#F0F2F4' : 'none'
      const kids = [
        c.style.bold ? '<hh:bold/>' : '',
        c.style.italic ? '<hh:italic/>' : '',
        c.style.underline || c.style.link
          ? `<hh:underline type="BOTTOM" shape="SOLID" color="${color}"/>`
          : '<hh:underline type="NONE" shape="SOLID" color="#000000"/>',
        c.style.strike
          ? `<hh:strikeout shape="CONTINUOUS" color="${color}"/>`
          : '<hh:strikeout shape="NONE" color="#000000"/>',
        c.style.sup ? '<hh:supscript/>' : '',
        c.style.sub ? '<hh:subscript/>' : '',
      ].join('')
      return `<hh:charPr id="${c.id}" height="${c.height}" textColor="${color}" shadeColor="${shade}" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1"><hh:fontRef hangul="${fontId}" latin="${fontId}" hanja="${fontId}" japanese="${fontId}" other="${fontId}" symbol="${fontId}" user="${fontId}"/><hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>${kids}</hh:charPr>`
    })
    .join('')

  const paraPropsXml = paraList
    .map((p) => {
      const headingAttr = p.headingLevel ? `<hh:heading type="OUTLINE" idRef="0" level="${p.headingLevel - 1}"/>` : '<hh:heading type="NONE" idRef="0" level="0"/>'
      return `<hh:paraPr id="${p.id}" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0"><hh:align horizontal="${hwpxAlign(p.align)}" vertical="BASELINE"/>${headingAttr}<hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD" widowOrphan="0" keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/><hh:autoSpacing eAsianEng="0" eAsianNum="0"/><hh:margin><hc:intent value="0" unit="HWPUNIT"/><hc:left value="${p.indent}" unit="HWPUNIT"/><hc:right value="0" unit="HWPUNIT"/><hc:prev value="0" unit="HWPUNIT"/><hc:next value="400" unit="HWPUNIT"/></hh:margin><hh:lineSpacing type="PERCENT" value="160" unit="HWPUNIT"/><hh:border borderFillIDRef="${p.borderFill}" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/></hh:paraPr>`
    })
    .join('')

  const langs = ['HANGUL', 'LATIN', 'HANJA', 'JAPANESE', 'OTHER', 'SYMBOL', 'USER']
  const fontfacesXml = `<hh:fontfaces itemCnt="7">${langs
    .map(
      (lang) =>
        `<hh:fontface lang="${lang}" fontCnt="2"><hh:font id="0" face="맑은 고딕" type="TTF" isEmbedded="0"/><hh:font id="1" face="Consolas" type="TTF" isEmbedded="0"/></hh:fontface>`,
    )
    .join('')}</hh:fontfaces>`

  const borderFillsXml = `<hh:borderFills itemCnt="6">
    <hh:borderFill id="1" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0"><hh:leftBorder type="NONE" width="0.1 mm" color="#000000"/><hh:rightBorder type="NONE" width="0.1 mm" color="#000000"/><hh:topBorder type="NONE" width="0.1 mm" color="#000000"/><hh:bottomBorder type="NONE" width="0.1 mm" color="#000000"/></hh:borderFill>
    <hh:borderFill id="2" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0"><hh:leftBorder type="SOLID" width="0.12 mm" color="#D0D7DE"/><hh:rightBorder type="SOLID" width="0.12 mm" color="#D0D7DE"/><hh:topBorder type="SOLID" width="0.12 mm" color="#D0D7DE"/><hh:bottomBorder type="SOLID" width="0.12 mm" color="#D0D7DE"/></hh:borderFill>
    <hh:borderFill id="3" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0"><hh:leftBorder type="SOLID" width="0.12 mm" color="#D0D7DE"/><hh:rightBorder type="SOLID" width="0.12 mm" color="#D0D7DE"/><hh:topBorder type="SOLID" width="0.12 mm" color="#D0D7DE"/><hh:bottomBorder type="SOLID" width="0.12 mm" color="#D0D7DE"/><hh:fillBrush><hc:winBrush faceColor="#F6F8FA" hatchColor="#999999" alpha="0"/></hh:fillBrush></hh:borderFill>
    <hh:borderFill id="4" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0"><hh:leftBorder type="SOLID" width="0.5 mm" color="#D0D7DE"/><hh:rightBorder type="NONE" width="0.1 mm" color="#000000"/><hh:topBorder type="NONE" width="0.1 mm" color="#000000"/><hh:bottomBorder type="NONE" width="0.1 mm" color="#000000"/></hh:borderFill>
    <hh:borderFill id="5" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0"><hh:leftBorder type="SOLID" width="0.12 mm" color="#D8DEE4"/><hh:rightBorder type="SOLID" width="0.12 mm" color="#D8DEE4"/><hh:topBorder type="SOLID" width="0.12 mm" color="#D8DEE4"/><hh:bottomBorder type="SOLID" width="0.12 mm" color="#D8DEE4"/><hh:fillBrush><hc:winBrush faceColor="#F6F8FA" hatchColor="#999999" alpha="0"/></hh:fillBrush></hh:borderFill>
    <hh:borderFill id="6" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0"><hh:leftBorder type="NONE" width="0.1 mm" color="#000000"/><hh:rightBorder type="NONE" width="0.1 mm" color="#000000"/><hh:topBorder type="NONE" width="0.1 mm" color="#000000"/><hh:bottomBorder type="SOLID" width="0.25 mm" color="#D0D7DE"/></hh:borderFill>
  </hh:borderFills>`

  const stylesXml = `<hh:styles itemCnt="7">
    <hh:style id="0" type="PARA" name="바탕글" engName="Normal" paraPrIDRef="0" charPrIDRef="0" nextStyleIDRef="0" langID="1042" lockForm="0"/>
    ${[1, 2, 3, 4, 5, 6].map((lvl) => `<hh:style id="${lvl}" type="PARA" name="개요 ${lvl}" engName="Outline ${lvl}" paraPrIDRef="0" charPrIDRef="0" nextStyleIDRef="0" langID="1042" lockForm="0"/>`).join('')}
  </hh:styles>`

  const headerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hh:head xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" version="1.4" secCnt="1">
  <hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/>
  <hh:refList>
    ${fontfacesXml}
    ${borderFillsXml}
    <hh:charProperties itemCnt="${charList.length}">${charPropsXml}</hh:charProperties>
    <hh:tabProperties itemCnt="1"><hh:tabPr id="0" autoTabLeft="0" autoTabRight="0"/></hh:tabProperties>
    <hh:numberings itemCnt="1"><hh:numbering id="1" start="0"><hh:paraHead start="1" level="1" align="LEFT" useInstWidth="1" autoIndent="1" widthAdjust="0" textOffsetType="PERCENT" textOffset="50" numFormat="DIGIT" charPrIDRef="4294967295" checkable="0">^1.</hh:paraHead></hh:numbering></hh:numberings>
    <hh:paraProperties itemCnt="${paraList.length}">${paraPropsXml}</hh:paraProperties>
    ${stylesXml}
  </hh:refList>
</hh:head>`

  const sectionXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hs:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core">${sectionBodyXml}</hs:sec>`

  const binManifest = images
    .map((img) => `<opf:item id="${img.id}" href="${img.href}" media-type="${img.mime}" isEmbeded="1"/>`)
    .join('\n    ')

  const contentHpf = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<opf:package xmlns:opf="http://www.idpf.org/2007/opf/" version="" unique-identifier="" id="">
  <opf:metadata>
    <opf:title>${escapeXml(parsed.title)}</opf:title>
    <opf:language>ko</opf:language>
  </opf:metadata>
  <opf:manifest>
    <opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>
    <opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>
    ${binManifest}
  </opf:manifest>
  <opf:spine>
    <opf:itemref idref="header" linear="yes"/>
    <opf:itemref idref="section0" linear="yes"/>
  </opf:spine>
</opf:package>`

  const versionXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" targetApplication="WORDPROCESSOR" major="5" minor="1" micro="0" buildNumber="1" os="1" xmlVersion="1.5" application="Chojema Editor" appVersion="0.8.2"/>`

  const containerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <ocf:rootfiles>
    <ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/>
  </ocf:rootfiles>
</ocf:container>`

  const manifestXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0">
  <odf:file-entry odf:full-path="/" odf:media-type="application/hwp+zip"/>
  <odf:file-entry odf:full-path="Contents/content.hpf" odf:media-type="application/hwpml-package+xml"/>
  <odf:file-entry odf:full-path="Contents/header.xml" odf:media-type="application/xml"/>
  <odf:file-entry odf:full-path="Contents/section0.xml" odf:media-type="application/xml"/>
</odf:manifest>`

  const zipFiles: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    mimetype: [strToU8('application/hwp+zip'), { level: 0 }],
    'version.xml': strToU8(versionXml),
    'META-INF/container.xml': strToU8(containerXml),
    'META-INF/manifest.xml': strToU8(manifestXml),
    'Contents/content.hpf': strToU8(contentHpf),
    'Contents/header.xml': strToU8(headerXml),
    'Contents/section0.xml': strToU8(sectionXml),
    'Preview/PrvText.txt': strToU8(prvLines.join('').replace(/\n{3,}/g, '\n\n').trim()),
  }
  for (const img of images) {
    zipFiles[img.href] = img.data.bytes
  }
  return zipSync(zipFiles)
}
