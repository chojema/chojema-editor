import { useCallback, useEffect, useRef, useState } from 'react'
import { docKindForPath, type DocKind, type InitialDoc } from '../shared/ipc'
import { lineEnding, type TextEncoding } from '../shared/encoding'
import { htmlToMarkdown } from './html/toMarkdown'
import { MarkdownSurface } from './markdown/MarkdownSurface'
import { HtmlSurface } from './html/HtmlSurface'
import { TextSurface } from './text/TextSurface'
import { ToastHost } from './components/toast'
import { AutoCopy } from './components/AutoCopy'
import { showToast } from './components/toast-bus'
import type { DocStats, SurfaceHandle } from './surface'
import { t, setLanguage, useI18n, type StringKey } from './i18n/locale'

const KIND_LABEL: Record<DocKind, StringKey> = {
  text: 'kindText',
  markdown: 'kindMarkdown',
  html: 'kindHtml',
}

const ZOOM_STEPS = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300]
const zoomIn = (value: number) => ZOOM_STEPS.find((step) => step > value) ?? value
const zoomOut = (value: number) => [...ZOOM_STEPS].reverse().find((step) => step < value) ?? value

/** files a drop on the window opens as documents (images go into the document instead) */
const OPENABLE = /\.(md|markdown|mdown|mkd|html?|xhtml|txt)$/i

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
  useI18n()
  const [initial, setInitial] = useState<InitialDoc | null>(null)
  const [path, setPath] = useState<string | null>(null)
  const [encoding, setEncoding] = useState<TextEncoding>('UTF-8')
  const [dirty, setDirty] = useState(false)
  const dirtyRef = useRef(false)
  const [stats, setStats] = useState<DocStats>({ words: 0, chars: 0 })
  const [zoom, setZoom] = useState(() => Number(readPref('chojema.zoom', '100')) || 100)
  const [wrap, setWrap] = useState(() => readPref('chojema.wrap', '1') === '1')
  const [autoCopy, setAutoCopy] = useState(false)
  const [autoComplete, setAutoComplete] = useState(true)
  const surfaceRef = useRef<SurfaceHandle>(null)

  useEffect(() => {
    let languageChanged = false
    const offLanguage = window.editorApi.onLanguageChanged((language) => {
      languageChanged = true
      setLanguage(language)
    })
    void window.editorApi.getInitialDoc().then((doc) => {
      if (!languageChanged) setLanguage(doc.language)
      setInitial(doc)
      setPath(doc.path)
      setEncoding(doc.encoding)
      setAutoCopy(doc.autoCopy)
      setAutoComplete(doc.autoComplete)
    })
    const offCopy = window.editorApi.onAutoCopyChanged(setAutoCopy)
    const offComplete = window.editorApi.onAutoCompleteChanged(setAutoComplete)
    return () => {
      offLanguage()
      offCopy()
      offComplete()
    }
  }, [])

  useEffect(() => writePref('chojema.zoom', String(zoom)), [zoom])
  useEffect(() => writePref('chojema.wrap', wrap ? '1' : '0'), [wrap])

  // a document file dropped anywhere on the window opens; other files are left to the editor
  useEffect(() => {
    const allow = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
    }
    const drop = (event: DragEvent) => {
      const files = Array.from(event.dataTransfer?.files ?? [])
      const docs = files.filter((file) => OPENABLE.test(file.name))
      if (docs.length === 0) return
      event.preventDefault()
      event.stopPropagation()
      window.editorApi.openPaths(docs.map((file) => window.editorApi.pathForFile(file)).filter(Boolean))
    }
    window.addEventListener('dragover', allow)
    window.addEventListener('drop', drop, true)
    return () => {
      window.removeEventListener('dragover', allow)
      window.removeEventListener('drop', drop, true)
    }
  }, [])

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
      if (result.encoding) setEncoding(result.encoding)
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

  const exportAs = useCallback(async (target: 'html' | 'markdown' | 'pdf' | 'print') => {
    const surface = surfaceRef.current
    if (!surface) return
    try {
      if (target === 'markdown') {
        if (initial?.kind !== 'html') return
        const result = await window.editorApi.exportMarkdown(htmlToMarkdown(surface.getContent()))
        if (result.ok) showToast(t('exported'))
        else if (result.error) showToast(t('exportFailed', { error: result.error }), 'error')
        return
      }
      const page = await surface.exportPage()
      if (target === 'print') {
        await window.editorApi.print(page)
        return
      }
      const result = target === 'html' ? await window.editorApi.exportHtml(page) : await window.editorApi.exportPdf(page)
      if (result.ok) showToast(t('exported'))
      else if (result.error) showToast(t('exportFailed', { error: result.error }), 'error')
    } catch (error) {
      showToast(t('exportFailed', { error: String(error) }), 'error')
    }
  }, [initial?.kind])

  useEffect(
    () =>
      window.editorApi.onMenuCommand((command) => {
        const surface = surfaceRef.current
        switch (command) {
          case 'save':
            void save()
            break
          case 'saveAs':
            void save(true)
            break
          case 'toggleSource':
            surface?.toggleSource()
            break
          case 'viewVisual':
            surface?.setMode('visual')
            break
          case 'viewSplit':
            surface?.setMode('split')
            break
          case 'viewSource':
            surface?.setMode('source')
            break
          case 'toggleOutline':
            surface?.toggleOutline()
            break
          case 'find':
            surface?.openFind(false)
            break
          case 'replace':
            surface?.openFind(true)
            break
          case 'toggleWrap':
            setWrap((value) => !value)
            break
          case 'zoomIn':
            setZoom(zoomIn)
            break
          case 'zoomOut':
            setZoom(zoomOut)
            break
          case 'zoomReset':
            setZoom(100)
            break
          case 'exportMarkdown':
            void exportAs('markdown')
            break
          case 'exportHtml':
            void exportAs('html')
            break
          case 'exportPdf':
            void exportAs('pdf')
            break
          case 'print':
            void exportAs('print')
            break
          case 'copyRich':
            void surface?.richCopy().then(({ html, text }) => {
              window.editorApi.copyRich(html, text)
              showToast(t('copiedRich'))
            })
            break
        }
      }),
    [save, exportAs],
  )

  useEffect(() => window.editorApi.onSaveBeforeClose(() => save()), [save])

  if (!initial) return <div className="app-loading">{t('loading')}</div>

  const surfaceProps = {
    kind: initial.kind,
    initialContent: initial.content,
    path,
    wrap,
    zoom,
    autoComplete,
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
        <button
          type="button"
          className="status-btn status-kind"
          title={t(!path && !dirty ? 'kindSwitchTip' : 'kindNewTip')}
          onClick={() => window.editorApi.showKindMenu()}
        >
          {t(KIND_LABEL[initial.kind])} ▾
        </button>
        <span className="status-path" title={path ?? ''}>
          {dirty ? '● ' : ''}
          {path ?? t('untitled')}
        </span>
        <span className="status-spacer" />
        {stats.lines !== undefined && <span>{t('statLines', { n: stats.lines })}</span>}
        <span>{t('statWords', { n: stats.words.toLocaleString() })}</span>
        <span>{t('statChars', { n: stats.chars.toLocaleString() })}</span>
        <span className={encoding === 'UTF-8' ? undefined : 'status-warn'} title={t('encodingTip')}>
          {encoding}
        </span>
        <span>{lineEnding(initial.content)}</span>
        <button
          type="button"
          className="status-btn"
          title={t(wrap ? 'wrapOn' : 'wrapOff')}
          onClick={() => setWrap((value) => !value)}
        >
          {wrap ? '↩︎' : '→'}
        </button>
        <button
          type="button"
          className={`status-btn status-toggle${autoCopy ? ' is-on' : ''}`}
          title={t('autoCopyTip')}
          aria-pressed={autoCopy}
          onClick={() => window.editorApi.setAutoCopy(!autoCopy)}
        >
          {t('autoCopy')}
        </button>
        <span className="status-zoom" role="group" aria-label={t('fontSize')}>
          <button
            type="button"
            className="status-btn status-step"
            title={t('zoomOutTip')}
            aria-label={t('zoomOutTip')}
            disabled={zoom <= ZOOM_STEPS[0]!}
            onClick={() => setZoom(zoomOut)}
          >
            −
          </button>
          <button type="button" className="status-btn status-zoom-value" title={t('zoomResetTip')} onClick={() => setZoom(100)}>
            {t('zoom', { n: zoom })}
          </button>
          <button
            type="button"
            className="status-btn status-step"
            title={t('zoomInTip')}
            aria-label={t('zoomInTip')}
            disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]!}
            onClick={() => setZoom(zoomIn)}
          >
            +
          </button>
        </span>
      </footer>
      <AutoCopy enabled={autoCopy} />
      <ToastHost />
    </div>
  )
}
