import { useEffect, useRef, useState } from 'react'
import { RASTER_FORMATS, type RasterFormat } from '../../shared/raster'
import { t, type StringKey } from '../i18n/locale'
import { showToast } from '../components/toast-bus'
import { rasterizeSvg, rasterSize } from './rasterize'

export function SvgExportDialog({ source, onClose }: { source: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [format, setFormat] = useState<RasterFormat>('png')
  const [transparent, setTransparent] = useState(true)
  const [background, setBackground] = useState('#ffffff')
  const [scale, setScale] = useState(1)
  const [quality, setQuality] = useState(90)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  let size = '', sizeError = ''
  try { const s = rasterSize(source, scale); size = `${s.width} × ${s.height} px` }
  catch (e) { sizeError = t((e as Error).message as StringKey) }
  useEffect(() => { dialog.current?.showModal() }, [])
  async function save() {
    setBusy(true); setError('')
    try {
      const request = await rasterizeSvg(source, { format, transparent, background, scale, quality })
      const result = await window.editorApi.exportRaster(request)
      if (result.ok) { showToast(t('exported')); onClose() }
      else if (result.error) setError(result.error)
    } catch (e) {
      const message = (e as Error).message
      setError(['svgError','svgSizeError','svgRasterError'].includes(message) ? t(message as StringKey) : String(e))
    } finally { setBusy(false) }
  }
  return <dialog ref={dialog} className="svg-export-dialog" aria-labelledby="svg-export-title"
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose() }}>
    <form onSubmit={(event) => { event.preventDefault(); if (!busy && !sizeError) void save() }}>
      <h2 id="svg-export-title">{t('svgExport')}</h2>
      <fieldset disabled={busy}>
        <label>{t('svgFormat')}<select aria-label={t('svgFormat')} value={format} onChange={e => setFormat(e.target.value as RasterFormat)}>
          {Object.entries(RASTER_FORMATS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
        </select></label>
        <label>{t('svgScale')}<select aria-label={t('svgScale')} value={scale} onChange={e => setScale(Number(e.target.value))}>
          {[1,2,3,4].map(n => <option key={n} value={n}>{n}×</option>)}
        </select></label>
        <output>{size}</output>
        <label className="svg-export-check"><input type="checkbox" checked={format !== 'jpg' && transparent}
          disabled={format === 'jpg'} onChange={e => setTransparent(e.target.checked)} />{t('svgTransparent')}</label>
        <label>{t('svgBackground')}<input type="color" value={background}
          disabled={format !== 'jpg' && transparent} onChange={e => setBackground(e.target.value)} /></label>
        {format !== 'png' && <label>{t('svgQuality')}<input type="number" min="1" max="100" required value={quality}
          onChange={e => setQuality(Number(e.target.value))} /></label>}
      </fieldset>
      <p className="svg-export-note">{t('svgBackgroundNote')}</p>
      {(error || sizeError) && <p role="alert">{error || sizeError}</p>}
      <div className="svg-export-actions">
        <button type="button" disabled={busy} onClick={onClose}>{t('svgCancel')}</button>
        <button type="submit" disabled={busy || !!sizeError}>{t(busy ? 'svgExporting' : 'svgExportSave')}</button>
      </div>
    </form>
  </dialog>
}
