import CFB from 'cfb'
import { deflateSync, unzipSync, strFromU8 } from 'fflate'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { EditorApi, InitialDoc, MenuCommand } from '../src/shared/ipc'
import { importBytesToKind, exportToBinaryFormat, exportToTextFormat } from '../src/renderer/convert'
import { hwpToHtml } from '../src/renderer/convert/hwp'
import { hwpxToHtml, htmlToHwpx } from '../src/renderer/convert/hwpx'
import { docxToHtml, htmlToDocx } from '../src/renderer/convert/docx'
import { pdfToHtml } from '../src/renderer/convert/pdf'
import { App } from '../src/renderer/App'

// 1x1 transparent PNG
const SAMPLE_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const SAMPLE_PNG_URL = `data:image/png;base64,${SAMPLE_PNG_B64}`

function u16le(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff]
}

function u32le(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]
}

function hwpRecord(tagId: number, level: number, payload: Uint8Array): Uint8Array {
  const size = payload.length
  const ext = size >= 0xfff
  const header = (tagId & 0x3ff) | ((level & 0x3ff) << 10) | ((ext ? 0xfff : size) << 20)
  const out = new Uint8Array(4 + (ext ? 4 : 0) + size)
  out.set(u32le(header >>> 0), 0)
  if (ext) out.set(u32le(size), 4)
  out.set(payload, ext ? 8 : 4)
  return out
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((s, c) => s + c.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}

function encodeUtf16Codes(codes: number[]): Uint8Array {
  const out = new Uint8Array(codes.length * 2)
  const view = new DataView(out.buffer)
  codes.forEach((c, i) => view.setUint16(i * 2, c, true))
  return out
}

function strToCodes(s: string): number[] {
  return Array.from(s, (ch) => ch.charCodeAt(0))
}

function makeSyntheticHwp({ encrypted = false }: { encrypted?: boolean } = {}): Uint8Array {
  const fileHeader = new Uint8Array(256)
  fileHeader.set(new TextEncoder().encode('HWP Document File'), 0)
  fileHeader.set(u32le(0x05000300), 32)
  fileHeader.set(u32le((encrypted ? 0x02 : 0x01)), 36) // compressed (or encrypted)

  const charNormal = new Uint8Array(72)
  new DataView(charNormal.buffer).setInt32(42, 1000, true)

  const charBold = new Uint8Array(72)
  new DataView(charBold.buffer).setInt32(42, 2000, true)
  new DataView(charBold.buffer).setUint32(46, 0x02, true) // bold

  const paraCenter = new Uint8Array(54)
  new DataView(paraCenter.buffer).setUint32(0, 3 << 2, true) // center

  const docInfoRaw = concatBytes([
    hwpRecord(21, 0, charNormal),
    hwpRecord(21, 0, charBold),
    hwpRecord(25, 0, paraCenter),
  ])

  const makeParaHeader = (paraShapeId = 0) => {
    const buf = new Uint8Array(22)
    const v = new DataView(buf.buffer)
    v.setUint16(8, paraShapeId, true)
    return buf
  }

  // Paragraph 1: bold title (20pt, centered)
  const p1Codes = [...strToCodes('한글 제목'), 13]
  const p1CharShape = new Uint8Array(8)
  new DataView(p1CharShape.buffer).setUint32(0, 0, true)
  new DataView(p1CharShape.buffer).setUint32(4, 1, true)

  // Paragraph 2: body + extended control (char 11 * 8 units) + table
  const p2Codes = [11, 0, 0, 0, 0, 0, 0, 0, ...strToCodes('본문 내용'), 13]
  const tblCtrl = new Uint8Array(4)
  // 'tbl ' little-endian = bytes ' lbt'
  tblCtrl.set([0x20, 0x6c, 0x62, 0x74], 0)
  const tblProps = new Uint8Array(8)
  new DataView(tblProps.buffer).setUint16(4, 1, true) // 1 row
  new DataView(tblProps.buffer).setUint16(6, 2, true) // 2 cols

  const makeCellListHeader = (col: number, row: number) => {
    const buf = new Uint8Array(32)
    const v = new DataView(buf.buffer)
    v.setInt16(0, 1, true)
    v.setUint16(6, col, true)
    v.setUint16(8, row, true)
    v.setUint16(10, 1, true)
    v.setUint16(12, 1, true)
    return buf
  }

  const sectionRaw = concatBytes([
    hwpRecord(66, 0, makeParaHeader(0)),
    hwpRecord(67, 1, encodeUtf16Codes(p1Codes)),
    hwpRecord(68, 1, p1CharShape),
    hwpRecord(66, 0, makeParaHeader(0)),
    hwpRecord(67, 1, encodeUtf16Codes(p2Codes)),
    hwpRecord(71, 1, tblCtrl),
    hwpRecord(77, 2, tblProps),
    hwpRecord(72, 2, makeCellListHeader(0, 0)),
    hwpRecord(66, 3, makeParaHeader(0)),
    hwpRecord(67, 4, encodeUtf16Codes([...strToCodes('셀A'), 13])),
    hwpRecord(72, 2, makeCellListHeader(1, 0)),
    hwpRecord(66, 3, makeParaHeader(0)),
    hwpRecord(67, 4, encodeUtf16Codes([...strToCodes('셀B'), 13])),
  ])

  const cfb = CFB.utils.cfb_new()
  CFB.utils.cfb_add(cfb, 'FileHeader', fileHeader)
  CFB.utils.cfb_add(cfb, 'DocInfo', deflateSync(docInfoRaw))
  CFB.utils.cfb_add(cfb, 'BodyText/Section0', deflateSync(sectionRaw))
  return new Uint8Array(CFB.write(cfb, { type: 'array' }))
}

function makeMinimalPdf(streamContent: string): Uint8Array {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${streamContent.length} >>\nstream\n${streamContent}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = [0]
  for (const obj of objects) {
    offsets.push(pdf.length)
    pdf += obj
  }
  const xrefPos = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`
  return new TextEncoder().encode(pdf)
}

describe('Text / Markdown / HTML mutual import & export', () => {
  it('converts between text, markdown, and html cleanly', async () => {
    const md = '---\ntitle: Demo\n---\n\n# 제목\n\n**굵게**와 *기울임* 문단\n\n- 항목 1\n- 항목 2\n'
    const textFromMd = await exportToTextFormat({ sourceKind: 'markdown', content: md, target: 'text' })
    expect(textFromMd).toContain('제목')
    expect(textFromMd).toContain('굵게와 기울임 문단')
    expect(textFromMd).toContain('• 항목 1')
    expect(textFromMd).not.toContain('title: Demo')

    const htmlFromMd = await importBytesToKind({
      name: 'note.md',
      bytes: new TextEncoder().encode(md),
      targetKind: 'html',
    })
    expect(htmlFromMd).toContain('<h1>제목</h1>')
    expect(htmlFromMd).toContain('<strong>굵게</strong>')

    const mdFromHtml = await exportToTextFormat({ sourceKind: 'html', content: htmlFromMd, target: 'markdown' })
    expect(mdFromHtml).toContain('# 제목')
    expect(mdFromHtml).toContain('**굵게**')

    const htmlFromText = await importBytesToKind({
      name: 'plain.txt',
      bytes: new TextEncoder().encode('첫 문단\n둘째 줄\n\n셋째 문단'),
      targetKind: 'html',
    })
    expect(htmlFromText).toContain('<p>첫 문단<br>둘째 줄</p>')
    expect(htmlFromText).toContain('<p>셋째 문단</p>')
  })

  it('decodes legacy EUC-KR text files when importing', async () => {
    // "한글" in EUC-KR
    const eucKr = new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb])
    const out = await importBytesToKind({ name: 'legacy.txt', bytes: eucKr, targetKind: 'markdown' })
    expect(out.trim()).toBe('한글')
  })
})

describe('DOCX import & export', () => {
  it('exports HTML with Korean text, formatting, links, tables, and images to DOCX and imports back', async () => {
    const html = `<!doctype html><html><head><title>보고서</title></head><body>
      <h1>문서 제목</h1>
      <p><strong>굵은</strong> <em>기울임</em> <a href="https://example.com">링크</a></p>
      <ul><li>첫째</li><li>둘째</li></ul>
      <table><tr><th>열1</th><th>열2</th></tr><tr><td>값A</td><td>값B</td></tr></table>
      <p><img src="${SAMPLE_PNG_URL}" alt="pixel"></p>
    </body></html>`

    const docxBytes = await exportToBinaryFormat({ html, title: '보고서', target: 'docx' })
    expect(docxBytes.byteLength).toBeGreaterThan(500)
    const zip = unzipSync(docxBytes)
    expect(zip['word/document.xml']).toBeDefined()

    const importedHtml = await docxToHtml(docxBytes, '보고서')
    expect(importedHtml).toContain('문서 제목')
    expect(importedHtml).toContain('<strong>굵은</strong>')
    expect(importedHtml).toContain('<em>기울임</em>')
    expect(importedHtml).toContain('https://example.com')
    expect(importedHtml).toContain('값A')
    expect(importedHtml).toContain('data:image/png;base64,')

    const importedMd = await importBytesToKind({ name: 'report.docx', bytes: docxBytes, targetKind: 'markdown' })
    expect(importedMd).toContain('# 문서 제목')
    expect(importedMd).toContain('**굵은**')
    expect(importedMd).toContain('| 열1 | 열2 |')
  })
})

describe('HWPX import & export', () => {
  it('exports valid OWPML HWPX archive and imports back with formatting, merged tables, and images', async () => {
    const html = `<!doctype html><html><head><title>한글문서</title></head><body>
      <h1>제목 1</h1>
      <p style="text-align:center"><strong>굵게</strong> <del>취소</del> <a href="https://example.org">참고</a></p>
      <table><tr><td colspan="2">병합 셀</td></tr><tr><td>왼쪽</td><td>오른쪽</td></tr></table>
      <p><img src="${SAMPLE_PNG_URL}" alt="img"></p>
    </body></html>`

    const hwpxBytes = await htmlToHwpx(html, '한글문서')
    const zip = unzipSync(hwpxBytes)
    expect(strFromU8(zip['mimetype']!)).toBe('application/hwp+zip')
    expect(zip['Contents/header.xml']).toBeDefined()
    expect(zip['Contents/section0.xml']).toBeDefined()
    expect(zip['Contents/content.hpf']).toBeDefined()
    expect(strFromU8(zip['Preview/PrvText.txt']!)).toContain('제목 1')

    const importedHtml = await hwpxToHtml(hwpxBytes, '한글문서')
    expect(importedHtml).toContain('<h1')
    expect(importedHtml).toContain('제목 1')
    expect(importedHtml).toContain('<strong>굵게</strong>')
    expect(importedHtml).toContain('<del>취소</del>')
    expect(importedHtml).toContain('https://example.org')
    expect(importedHtml).toContain('colspan="2"')
    expect(importedHtml).toContain('병합 셀')
    expect(importedHtml).toContain('data:image/png;base64,')

    const importedText = await importBytesToKind({ name: 'doc.hwpx', bytes: hwpxBytes, targetKind: 'text' })
    expect(importedText).toContain('제목 1')
    expect(importedText).toContain('병합 셀')
  })
})

describe('HWP 5.0 binary import', () => {
  it('parses compressed HWP 5.0 paragraphs, bold headings, and tables', async () => {
    const bytes = makeSyntheticHwp()
    const html = await hwpToHtml(bytes, '테스트')
    expect(html).toContain('<h1 style="text-align:center">한글 제목</h1>')
    expect(html).toContain('본문 내용')
    expect(html).toContain('<table><tr><td><p style="text-align:center">셀A</p></td><td><p style="text-align:center">셀B</p></td></tr></table>')

    const md = await importBytesToKind({ name: 'sample.hwp', bytes, targetKind: 'markdown' })
    expect(md).toContain('# 한글 제목')
    expect(md).toContain('본문 내용')
    expect(md).toContain('| 셀A | 셀B |')
  })

  it('rejects encrypted HWP files with a clear error', async () => {
    const encrypted = makeSyntheticHwp({ encrypted: true })
    await expect(hwpToHtml(encrypted)).rejects.toThrow('암호로 보호된 HWP')
  })
})

describe('PDF import', () => {
  it('extracts headings and body paragraphs from text-based PDFs', async () => {
    const stream = [
      'BT',
      '/F1 24 Tf 72 720 Td (Main Heading) Tj',
      '/F1 12 Tf 0 -30 Td (First body line) Tj',
      '0 -14 Td (continued line.) Tj',
      '0 -40 Td (Second paragraph.) Tj',
      'ET',
    ].join('\n')
    const pdfBytes = makeMinimalPdf(stream)
    const html = await pdfToHtml(pdfBytes, 'sample')
    expect(html).toContain('<h1>Main Heading</h1>')
    expect(html).toContain('<p>First body line continued line.</p>')
    expect(html).toContain('<p>Second paragraph.</p>')

    const md = await importBytesToKind({ name: 'sample.pdf', bytes: pdfBytes, targetKind: 'markdown' })
    expect(md).toContain('# Main Heading')
    expect(md).toContain('First body line continued line.')
  })

  it('rejects PDFs without extractable text', async () => {
    const emptyPdf = makeMinimalPdf('q Q')
    await expect(pdfToHtml(emptyPdf)).rejects.toThrow('텍스트를 추출할 수 없는 PDF')
  })
})

describe('App import UX flows', () => {
  let root: Root | undefined
  const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

  beforeEach(() => {
    actGlobal.IS_REACT_ACT_ENVIRONMENT = true
    const prefs = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => prefs.get(k) ?? null, setItem: (k: string, v: string) => prefs.set(k, v) })
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
  })

  afterEach(async () => {
    await act(async () => root?.unmount())
    root = undefined
    document.body.replaceChildren()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    actGlobal.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('asks target format when opening an external HWPX file and loads converted Markdown', async () => {
    const hwpxBytes = await htmlToHwpx('<h1>변환 테스트</h1><p>본문입니다.</p>', 'memo')
    const setConvertedKind = vi.fn()
    const initial: InitialDoc = {
      path: null,
      kind: 'markdown',
      content: '',
      encoding: 'UTF-8',
      language: 'ko',
      autoCopy: false,
      autoComplete: true,
      importFile: { name: 'memo.hwpx', bytes: hwpxBytes },
    }
    const noop = () => () => {}
    window.editorApi = {
      getInitialDoc: async () => initial,
      onLanguageChanged: noop,
      onAutoCopyChanged: noop,
      onAutoCompleteChanged: noop,
      onSaveBeforeClose: noop,
      onMenuCommand: noop,
      setDirty: vi.fn(),
      setConvertedKind,
    } as unknown as EditorApi

    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(createElement(App)))

    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain('memo.hwpx')
    const mdBtn = Array.from(document.querySelectorAll<HTMLButtonElement>('.modal-choice'))[0]!
    await act(async () => {
      mdBtn.click()
    })
    for (let i = 0; i < 60; i++) {
      if (document.querySelector('.ProseMirror')?.textContent?.includes('변환 테스트')) break
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50))
      })
    }
    expect(document.querySelector('.ProseMirror')?.textContent).toContain('변환 테스트')
    expect(setConvertedKind).toHaveBeenCalledWith('markdown', 'memo')
  }, 15000)

  it('imports a DOCX file into an open text document via File > Import menu command', async () => {
    const docxBytes = await htmlToDocx('<h1>제목</h1><p>텍스트 추출 확인</p>', 'in')
    let menuHandler: ((cmd: MenuCommand) => void) | undefined
    const noop = () => () => {}
    window.editorApi = {
      getInitialDoc: async () => ({
        path: null,
        kind: 'text',
        content: '',
        encoding: 'UTF-8',
        language: 'ko',
        autoCopy: false,
        autoComplete: true,
      }),
      onLanguageChanged: noop,
      onAutoCopyChanged: noop,
      onAutoCompleteChanged: noop,
      onSaveBeforeClose: noop,
      onMenuCommand: (h: (cmd: MenuCommand) => void) => { menuHandler = h; return noop() },
      setDirty: vi.fn(),
      pickImportFile: async () => ({ name: 'in.docx', path: null, bytes: docxBytes }),
    } as unknown as EditorApi

    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(createElement(App)))
    await act(async () => {
      for (let i = 0; i < 20; i++) {
        if (document.querySelector('.cm-content')) break
        await new Promise((r) => setTimeout(r, 25))
      }
    })
    expect(document.querySelector('.cm-content')).not.toBeNull()

    await act(async () => {
      menuHandler?.('importFile')
      for (let i = 0; i < 20; i++) {
        if (document.querySelector('.cm-content')?.textContent?.includes('텍스트 추출 확인')) break
        await new Promise((r) => setTimeout(r, 25))
      }
    })
    expect(document.querySelector('.cm-content')?.textContent).toContain('텍스트 추출 확인')
  }, 15000)

  it('prompts Replace vs Append when importing into a non-empty document', async () => {
    let menuHandler: ((cmd: MenuCommand) => void) | undefined
    const noop = () => () => {}
    window.editorApi = {
      getInitialDoc: async () => ({
        path: '/tmp/existing.txt',
        kind: 'text',
        content: '기존 내용',
        encoding: 'UTF-8',
        language: 'ko',
        autoCopy: false,
        autoComplete: true,
      }),
      onLanguageChanged: noop,
      onAutoCopyChanged: noop,
      onAutoCompleteChanged: noop,
      onSaveBeforeClose: noop,
      onMenuCommand: (h: (cmd: MenuCommand) => void) => { menuHandler = h; return noop() },
      setDirty: vi.fn(),
      pickImportFile: async () => ({
        name: 'extra.md',
        path: null,
        bytes: new TextEncoder().encode('# 추가 제목\n\n추가 본문'),
      }),
    } as unknown as EditorApi

    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(createElement(App)))

    await act(async () => {
      menuHandler?.('importFile')
      for (let i = 0; i < 20; i++) {
        if (document.querySelector('[role="dialog"]')) break
        await new Promise((r) => setTimeout(r, 25))
      }
    })
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('extra.md')
    const appendBtn = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find((b) =>
      b.textContent?.includes('이어 붙이기'),
    )!
    await act(async () => {
      appendBtn.click()
    })
    const text = document.querySelector('.cm-content')?.textContent ?? ''
    expect(text).toContain('기존 내용')
    expect(text).toContain('추가 본문')
  }, 15000)
})
