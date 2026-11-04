import { useCallback, useEffect, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import type { PreviewTarget } from '../../shared/ipc'
import { t } from '../i18n/locale'

/** edits settle this long before the page is reloaded with them */
const REFRESH_DELAY_MS = 600

/**
 * Scripts, forms and dialogs run; the frame has an opaque origin, so the page
 * cannot reach the editor, its storage or its API. Links that open a new
 * window go to the browser through the editor window's open handler.
 */
const SANDBOX = 'allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox'

const WIDTH_KEY = 'chojema.runPreview.width'

function readWidth(): number {
  try {
    const saved = Number(localStorage.getItem(WIDTH_KEY))
    return saved >= 0.2 && saved <= 0.8 ? saved : 0.45
  } catch {
    return 0.45
  }
}

function writeWidth(value: number): void {
  try {
    localStorage.setItem(WIDTH_KEY, String(value))
  } catch {
    // a blocked store only forgets the width
  }
}

interface Props {
  /** the document text as it stands now, unsaved edits included */
  getHtml: () => string
  /** the surface calls the function placed here after every edit */
  notifyRef: MutableRefObject<(() => void) | null>
  onClose: () => void
}

/**
 * Read-only pane that runs the HTML document as a browser would, beside the
 * editor. It reloads a moment after the user stops typing.
 */
export function RunPreview({ getHtml, notifyRef, onClose }: Props) {
  const [target, setTarget] = useState<(PreviewTarget & { key: number }) | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [ratio, setRatio] = useState(readWidth)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const paneRef = useRef<HTMLDivElement>(null)
  const timer = useRef<number | null>(null)
  const counter = useRef(0)
  const posted = useRef(-1)
  const getHtmlRef = useRef(getHtml)
  getHtmlRef.current = getHtml

  const refresh = useCallback(async () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    const api = window.editorApi.preview
    if (!api) {
      setUnavailable(true)
      return
    }
    const next = await api(getHtmlRef.current())
    if (!next) {
      setUnavailable(true)
      return
    }
    const key = ++counter.current
    // a new query string makes the frame load again even when the URL is otherwise the same
    const url = `${next.url}${next.url.includes('?') ? '&' : '?'}r=${key}`
    setUnavailable(false)
    setTarget({ ...next, url, key })
  }, [])

  useEffect(() => {
    void refresh()
    notifyRef.current = () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => void refresh(), REFRESH_DELAY_MS)
    }
    return () => {
      notifyRef.current = null
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [refresh, notifyRef])

  // a host page that cannot be served the document gets it by message, once per load
  const onLoad = () => {
    if (!target?.post || posted.current === target.key) return
    posted.current = target.key
    frameRef.current?.contentWindow?.postMessage(target.post, '*')
  }

  const startDrag = (event: React.PointerEvent) => {
    event.preventDefault()
    const box = paneRef.current?.parentElement?.getBoundingClientRect()
    if (!box) return
    const move = (e: PointerEvent) => {
      setRatio(Math.min(0.8, Math.max(0.2, (box.right - e.clientX) / box.width)))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('is-resizing')
      setRatio((value) => {
        writeWidth(value)
        return value
      })
    }
    document.body.classList.add('is-resizing')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <>
      <div className="pane-divider" role="separator" aria-orientation="vertical" onPointerDown={startDrag} />
      <div className="run-preview" ref={paneRef} style={{ flexBasis: `${ratio * 100}%` }}>
        <div className="run-preview-bar">
          <span className="run-preview-title">{t('runPreview')}</span>
          <button type="button" className="run-preview-btn" title={t('runPreviewRefresh')} onClick={() => void refresh()}>
            ↻
          </button>
          <button type="button" className="run-preview-btn" title={t('runPreviewClose')} aria-label={t('runPreviewClose')} onClick={onClose}>
            ×
          </button>
        </div>
        {unavailable ? (
          <div className="run-preview-note">{t('runPreviewUnavailable')}</div>
        ) : (
          target && (
            <iframe
              key={target.key}
              ref={frameRef}
              className="run-preview-frame"
              title={t('runPreview')}
              src={target.url}
              sandbox={SANDBOX}
              onLoad={onLoad}
            />
          )
        )}
      </div>
    </>
  )
}
