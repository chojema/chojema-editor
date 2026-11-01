import { describe, expect, it } from 'vitest'
import { DEFAULT_EXTENSION, docKindForPath } from '../src/shared/ipc'
import { svgImageHtml, svgPreviewUrl } from '../src/renderer/svg/svgDocument'

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle r="8" fill="red"/></svg>'

describe('SVG document', () => {
  it('recognizes SVG paths and saves with the SVG extension', () => {
    expect(docKindForPath('/tmp/그림.SVG')).toBe('svg')
    expect(DEFAULT_EXTENSION.svg).toBe('svg')
  })
  it('preserves XML, Unicode, comments, BOM and line endings in the image', () => {
    const text = '\uFEFF<?xml version="1.0"?>\r\n<!-- 한글 # & -->\r\n' + svg
    expect(decodeURIComponent(svgPreviewUrl(text)!.split(',')[1]!)).toBe(text)
  })
  it('rejects incomplete XML, non-SVG roots and missing/wrong namespaces', () => {
    for (const text of ['', ' ', '<svg', '<svg/>', '<html/>', '<svg xmlns="wrong"/>', svg + '<extra/>']) {
      expect(svgPreviewUrl(text)).toBeNull()
    }
  })
  it('exports as an image rather than executable inline markup', () => {
    const text = svg.replace('<circle', '<script>alert(1)</script><circle')
    const html = svgImageHtml(text)
    const doc = new DOMParser().parseFromString(html, 'text/html')
    expect(doc.querySelectorAll('img')).toHaveLength(1)
    expect(doc.querySelector('svg,script')).toBeNull()
    expect(doc.querySelector('img')!.getAttribute('src')).toBe(svgPreviewUrl(text))
    expect(() => svgImageHtml('<svg')).toThrow('Invalid SVG')
  })
})
