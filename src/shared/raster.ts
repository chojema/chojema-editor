export const RASTER_FORMATS = {
  png: { mime: 'image/png', label: 'PNG' },
  jpg: { mime: 'image/jpeg', label: 'JPG' },
  webp: { mime: 'image/webp', label: 'WebP' },
} as const
export type RasterFormat = keyof typeof RASTER_FORMATS
export interface RasterExportRequest { format: RasterFormat; bytes: Uint8Array }

export function validRasterRequest(request: RasterExportRequest): boolean {
  if (!request || !Object.hasOwn(RASTER_FORMATS, request.format)) return false
  const b = request.bytes
  if ((!ArrayBuffer.isView(b) || Object.prototype.toString.call(b) !== '[object Uint8Array]') || b.length < 12 || b.length > 128 * 1024 * 1024) return false
  if (request.format === 'png') return [137,80,78,71,13,10,26,10].every((n,i) => b[i] === n)
  if (request.format === 'jpg') return b[0] === 255 && b[1] === 216 && b[2] === 255
  return String.fromCharCode(...b.slice(0,4)) === 'RIFF' && String.fromCharCode(...b.slice(8,12)) === 'WEBP'
}
