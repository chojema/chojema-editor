import { describe, expect, it } from 'vitest'
import { rasterSize } from '../src/renderer/svg/rasterize'
import { validRasterRequest } from '../src/shared/raster'
const svg = (attrs: string) => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}/>`
describe('SVG raster dimensions', () => {
  it('scales explicit dimensions, physical units and viewBox-only images', () => {
    expect(rasterSize(svg('width="120" height="80"'), 2)).toEqual({ width: 240, height: 160 })
    expect(rasterSize(svg('width="1in" height="72pt"'))).toEqual({ width: 96, height: 96 })
    expect(rasterSize(svg('viewBox="0 0 200 100"'))).toEqual({ width: 200, height: 100 })
    expect(rasterSize(svg('width="80" viewBox="0 0 200 100"'))).toEqual({ width: 80, height: 40 })
    expect(rasterSize(svg('width="100%" height="100%" viewBox="0 0 200 100"'))).toEqual({ width: 200, height: 100 })
    expect(rasterSize(svg(''))).toEqual({ width: 300, height: 150 })
  })
  it('rejects malformed SVG and unsafe canvas sizes before allocation', () => {
    expect(() => rasterSize('<svg')).toThrow('svgError')
    for (const attrs of ['width="20000" height="20"', 'width="8000" height="8000"']) {
      expect(() => rasterSize(svg(attrs))).toThrow('svgSizeError')
    }
    for (const scale of [0, -1, NaN, Infinity]) expect(() => rasterSize(svg(''), scale)).toThrow('svgSizeError')
  })
})
describe('raster IPC validation', () => {
  it('accepts only bytes matching their selected image format', () => {
    const png = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0])
    const jpg = new Uint8Array([255,216,255,0,0,0,0,0,0,0,0,0])
    const webp = new TextEncoder().encode('RIFF0000WEBP')
    expect(validRasterRequest({ format: 'png', bytes: png })).toBe(true)
    expect(validRasterRequest({ format: 'jpg', bytes: jpg })).toBe(true)
    expect(validRasterRequest({ format: 'webp', bytes: webp })).toBe(true)
    expect(validRasterRequest({ format: 'webp', bytes: png })).toBe(false)
    expect(validRasterRequest({ format: 'png', bytes: new Uint8Array(4) })).toBe(false)
    expect(validRasterRequest({ format: 'constructor' as 'png', bytes: png })).toBe(false)
  })
})
