import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { SvgExportDialog } from './SvgExportDialog'
import { ViewModeSwitch } from '../components/Toolbar'
import { t } from '../i18n/locale'
import { statsOf, type SurfaceHandle, type SurfaceProps } from '../surface'
import { Panes, useViewModes } from '../views'
import { svgImageHtml, svgPreviewUrl } from './svgDocument'

/** SVG source is authoritative; the visual pane is an isolated image preview. */
export const SvgSurface = forwardRef<SurfaceHandle, SurfaceProps>(function SvgSurface(
  { initialContent, wrap, zoom, autoComplete, onDirty, onStats }, ref,
) {
  const [exportSource, setExportSource] = useState<string | null>(null)
  const [text, setText] = useState(initialContent)
  const textRef = useRef(initialContent)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const [findRequested, setFindRequested] = useState(false)
  const load = useCallback((raw: string) => {
    textRef.current = raw
    setText(raw)
  }, [])
  const serialize = useCallback(() => textRef.current, [])
  const views = useViewModes({
    prefKey: 'svg', serialize, load, onDirty, onStats,
    initialSource: initialContent, defaultMode: 'split',
  })
  useEffect(() => window.editorApi.onMenuCommand(command => {
    if (command === 'exportImage') setExportSource(views.getContent())
  }), [views.getContent])
  const url = useMemo(() => svgPreviewUrl(text), [text])
  useEffect(() => onStats({ ...statsOf(text), lines: text.split('\n').length }), [text, onStats])
  useEffect(() => {
    if (findRequested && views.mode !== 'visual') {
      views.sourceRef.current?.openFind()
      setFindRequested(false)
    }
  }, [findRequested, views.mode, views.sourceRef])

  useImperativeHandle(ref, () => ({
    getContent: views.getContent,
    undo: () => { views.sourceHistory('undo') },
    redo: () => { views.sourceHistory('redo') },
    markSaved: () => views.settle(),
    setMode: views.setMode,
    toggleSource: () => views.setMode(views.mode === 'source' ? 'split' : 'source'),
    toggleOutline: () => {},
    openFind: () => {
      if (views.mode === 'visual') views.setMode('split')
      setFindRequested(true)
    },
    exportPage: async () => ({
      html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>SVG</title></head><body>${svgImageHtml(views.getContent())}</body></html>`,
      baseDir: null,
    }),
    richCopy: async () => ({ html: svgImageHtml(views.getContent()), text: views.getContent() }),
  }))

  return (
    <div className="surface svg-surface">
      <div className="toolbar">
        <span className="svg-label">{t('svgPreview')}</span>
        <button type="button" className="svg-export-button" onClick={() => setExportSource(views.getContent())}>{t('svgExport')}</button>
        <span className="tb-spacer" />
        <ViewModeSwitch mode={views.mode} onMode={views.setMode} kind="svg" />
      </div>
      {exportSource !== null && <SvgExportDialog source={exportSource} onClose={() => setExportSource(null)} />}
      <Panes views={views} prefKey="svg" language="svg" wrap={wrap} zoom={zoom}
        completion={autoComplete} visualScrollRef={scrollRef} visualClassName="svg-preview" keepSourceMounted>
        {!text.trim() ? <p className="svg-message">{t('svgEmpty')}</p> :
          !url || failedUrl === url ? <p className="svg-message" role="alert">{t('svgError')}</p> :
            <img key={url} className="svg-image" src={url} alt={t('svgPreview')}
              onLoad={() => setFailedUrl(null)} onError={() => setFailedUrl(url)} />}
      </Panes>
    </div>
  )
})
