import { RASTER_FORMATS, type RasterExportRequest, type RasterFormat } from '../../shared/raster'
import { svgPreviewUrl } from './svgDocument'

export interface RasterOptions {
  format: RasterFormat
  scale: number
  transparent: boolean
  background: string
  quality: number
}

/** Absolute SVG lengths in CSS pixels; percentages use the viewBox fallback. */
function pixels(value: string | null): number | null {
  const match = value?.trim().match(/^(\d*\.?\d+(?:e[+-]?\d+)?)\s*(px|in|cm|mm|pt|pc|q)?$/i)
  if (!match) return null
  const factors: Record<string, number> = { px: 1, in: 96, cm: 96/2.54, mm: 96/25.4, pt: 96/72, pc: 16, q: 96/101.6 }
  const n = Number(match[1]) * factors[(match[2] ?? 'px').toLowerCase()]!
  return n > 0 && Number.isFinite(n) ? n : null
}

export function rasterSize(text: string, scale = 1): { width: number; height: number } {
  if (!svgPreviewUrl(text)) throw new Error('svgError')
  const root = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement
  const box = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number)
  const ratio = box.length === 4 && box.every(Number.isFinite) && box[2]! > 0 && box[3]! > 0 ? box[2]! / box[3]! : null
  let width = pixels(root.getAttribute('width')), height = pixels(root.getAttribute('height'))
  if (!width && !height && ratio) { width = box[2]!; height = box[3]! }
  width ??= height && ratio ? height * ratio : 300
  height ??= ratio ? width / ratio : 150
  width = Math.round(width * scale); height = Math.round(height * scale)
  if (!Number.isFinite(scale) || scale <= 0 || width < 1 || height < 1 || width > 16384 || height > 16384 || width * height > 32_000_000) {
    throw new Error('svgSizeError')
  }
  return { width, height }
}

export async function rasterizeSvg(text: string, options: RasterOptions): Promise<RasterExportRequest> {
  const { width, height } = rasterSize(text, options.scale)
  const base = rasterSize(text)
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
  // Give percentage/viewBox-only SVGs an explicit viewport for rasterization.
  doc.documentElement.setAttribute('width', String(base.width))
  doc.documentElement.setAttribute('height', String(base.height))
  const url = svgPreviewUrl(new XMLSerializer().serializeToString(doc))!
  const image = new Image()
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => { image.src = ''; reject(new Error('svgError')) }, 15000)
    image.onload = () => { clearTimeout(timer); resolve() }
    image.onerror = () => { clearTimeout(timer); reject(new Error('svgError')) }
    image.src = url
  })
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  try {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('svgRasterError')
    if (options.format === 'jpg' || !options.transparent) {
      ctx.fillStyle = /^#[\da-f]{6}$/i.test(options.background) ? options.background : '#ffffff'
      ctx.fillRect(0, 0, width, height)
    }
    ctx.drawImage(image, 0, 0, width, height)
    const mime = RASTER_FORMATS[options.format].mime
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, options.quality / 100))
    if (!blob || blob.type !== mime) throw new Error('svgRasterError')
    return { format: options.format, bytes: new Uint8Array(await blob.arrayBuffer()) }
  } finally {
    canvas.width = 0; canvas.height = 0
  }
}
