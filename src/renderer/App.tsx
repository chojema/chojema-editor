import { useCallback, useEffect, useRef, useState } from 'react'
import { docKindForPath, type DocKind, type InitialDoc } from '../shared/ipc'
import { MarkdownSurface } from './markdown/MarkdownSurface'
import { HtmlSurface } from './html/HtmlSurface'
import { TextSurface } from './text/TextSurface'
import { ToastHost } from './components/toast'
import { showToast } from './components/toast-bus'
import type { DocStats, SurfaceHandle } from './surface'
import { t, type StringKey } from './i18n/locale'

const KIND_LABEL: Record<DocKind, StringKey> = {
  text: 'kindText',
  markdown: 'kindMarkdown',
  html: 'kindHtml',
}

const ZOOM_STEPS = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200]

function readPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // preferences are a convenience; a blocked store just forgets them
  }
}

export function App() {
  const [initial, setInitial] = useState<InitialDoc | null>(null)
  const [path, setPath] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const dirtyRef = useRef(false)
  const [stats, setStats] = useState<DocStats>({ words: 0, chars: 0 })
  const [zoom, setZoom] = useState(() => Number(readPref('chojema.zoom', '100')) || 100)
  const [wrap, setWrap] = useState(() => readPref('chojema.wrap', '1') === '1')
  const surfaceRef = useRef<SurfaceHandle>(null)

  useEffect(() => {
    void window.editorApi.getInitialDoc().then((doc) => {
      setInitial(doc)
      setPath(doc.path)
    })
  }, [])

  useEffect(() => writePref('chojema.zoom', String(zoom)), [zoom])
  useEffect(() => writePref('chojema.wrap', wrap ? '1' : '0'), [wrap])

  const markDirty = useCallback(() => {
    if (dirtyRef.current) return
    dirtyRef.current = true
    setDirty(true)
    window.editorApi.setDirty(true)
  }, [])

  const save = useCallback(
    async (as = false): Promise<boolean> => {
      const surface = surfaceRef.current
      if (!surface || !initial) return false
      const content = surface.getContent()
      const result = as
        ? await window.editorApi.saveAs(content, initial.kind)
        : await window.editorApi.save(content, initial.kind)
      if (!result.ok) {
        if (result.error) showToast(t('saveFailed', { error: result.error }), 'error')
        return false
      }
      surface.markSaved(content)
      dirtyRef.current = false
      setDirty(false)
      window.editorApi.setDirty(false)
      if (result.path) {
        setPath(result.path)
        // Save As into another format reopens the file on the matching surface
        if (docKindForPath(result.path) !== initial.kind && /\.(md|markdown|html?|txt)$/i.test(result.path)) {
          window.location.reload()
          return true
        }
      }
      showToast(t('saved'))
      return true
    },
    [initial],
  )

  useEffect(
    () =>
      window.editorApi.onMenuCommand((command) => {
        switch (command) {
          case 'save':
            void save()
            break
          case 'saveAs':
            void save(true)
            break
          case 'toggleSource':
            surfaceRef.current?.toggleSource()
            break
          case 'find':
            surfaceRef.current?.openFind()
            break
          case 'toggleWrap':
            setWrap((value) => !value)
            break
          case 'zoomIn':
            setZoom((value) => ZOOM_STEPS.find((step) => step > value) ?? value)
            break
          case 'zoomOut':
            setZoom((value) => [...ZOOM_STEPS].reverse().find((step) => step < value) ?? value)
            break
          case 'zoomReset':
            setZoom(100)
            break
        }
      }),
    [save],
  )

  useEffect(() => window.editorApi.onSaveBeforeClose(() => save()), [save])

  if (!initial) return <div className="app-loading">{t('loading')}</div>

  const surfaceProps = {
    kind: initial.kind,
    initialContent: initial.content,
    path,
    wrap,
    zoom,
    onDirty: markDirty,
    onStats: setStats,
    onSave: () => void save(),
  }

  return (
    <div className="app">
      {initial.kind === 'markdown' && <MarkdownSurface ref={surfaceRef} {...surfaceProps} />}
      {initial.kind === 'html' && <HtmlSurface ref={surfaceRef} {...surfaceProps} />}
      {initial.kind === 'text' && <TextSurface ref={surfaceRef} {...surfaceProps} />}
      <footer className="status-bar">
        <span className="status-kind">{t(KIND_LABEL[initial.kind])}</span>
        <span className="status-path" title={path ?? ''}>
          {dirty ? '● ' : ''}
          {path ?? t('untitled')}
        </span>
        <span className="status-spacer" />
        {stats.lines !== undefined && <span>{t('statLines', { n: stats.lines })}</span>}
        <span>{t('statWords', { n: stats.words.toLocaleString() })}</span>
        <span>{t('statChars', { n: stats.chars.toLocaleString() })}</span>
        <button
          type="button"
          className="status-btn"
          title={t(wrap ? 'wrapOn' : 'wrapOff')}
          onClick={() => setWrap((value) => !value)}
        >
          {wrap ? '↩︎' : '→'}
        </button>
        <button type="button" className="status-btn" onClick={() => setZoom(100)}>
          {t('zoom', { n: zoom })}
        </button>
      </footer>
      <ToastHost />
    </div>
  )
}
