/** Validate in a detached XML document; never insert SVG markup into the app DOM. */
export function svgPreviewUrl(text: string): string | null {
  if (!text.trim()) return null
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
  const root = doc.documentElement
  if (doc.querySelector('parsererror') || root.localName !== 'svg' ||
      root.namespaceURI !== 'http://www.w3.org/2000/svg') return null
  // An image document disables scripts and external resources. Keep the original
  // source untouched (including XML declaration, comments, whitespace and BOM).
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`
}

export function svgImageHtml(text: string): string {
  const url = svgPreviewUrl(text)
  if (!url) throw new Error('Invalid SVG')
  return `<img alt="SVG" style="max-width:100%;height:auto" src="${url}">`
}
