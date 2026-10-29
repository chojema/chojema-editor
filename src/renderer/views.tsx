import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { CodeEditor, type CodeEditorHandle, type CodeLanguage } from './text/CodeEditor'
import { statsOf, type DocStats } from './surface'

/** how a Markdown or HTML document is shown */
export type ViewMode = 'visual' | 'split' | 'source'

/** edits settle this long before they are copied to the other pane */
const SYNC_DELAY_MS = 250

function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // a blocked store only forgets the layout
  }
}

interface Options {
  /** per-kind key for the remembered view mode and split ratio */
  prefKey: string
  /** the document text as the visual editor would save it now */
  serialize: () => string
  /** rebuild the visual editor from text; `undoable` puts the change on its undo stack */
  load: (text: string, undoable: boolean) => void
  onDirty: () => void
  onStats: (stats: DocStats) => void
}

/**
 * View modes shared by the Markdown and HTML surfaces. In the split view both
 * panes are editable: a source edit is parsed into the visual editor, and a
 * visual edit is serialized back into the source, each after a short pause.
 * Neither direction echoes back, because loading the visual editor emits no
 * update and writing the source is marked programmatic.
 */
export function useViewModes({ prefKey, serialize, load, onDirty, onStats }: Options) {
  const [mode, setModeState] = useState<ViewMode>(() => {
    const saved = readPref(`chojema.view.${prefKey}`)
    return saved === 'split' || saved === 'source' ? saved : 'visual'
  })
  const modeRef = useRef(mode)
  modeRef.current = mode
  const [sourceSeed, setSourceSeed] = useState('')
  const sourceRef = useRef<CodeEditorHandle>(null)
  /** the source text the visual editor currently reflects */
  const syncedRef = useRef('')
  const pendingSourceRef = useRef<string | null>(null)
  const sourceTimer = useRef<number | null>(null)
  const editorTimer = useRef<number | null>(null)
  /** which pane the user worked in last, for find and focus */
  const lastPaneRef = useRef<'visual' | 'source'>('visual')

  const fns = useRef({ serialize, load, onDirty, onStats })
  fns.current = { serialize, load, onDirty, onStats }

  const flushSource = useCallback(() => {
    if (sourceTimer.current) window.clearTimeout(sourceTimer.current)
    sourceTimer.current = null
    const text = pendingSourceRef.current
    pendingSourceRef.current = null
    if (text === null || text === syncedRef.current) return
    fns.current.load(text, true)
    syncedRef.current = text
  }, [])

  const flushEditor = useCallback(() => {
    if (editorTimer.current) window.clearTimeout(editorTimer.current)
    if (editorTimer.current === null) return
    editorTimer.current = null
    const text = fns.current.serialize()
    syncedRef.current = text
    sourceRef.current?.setValue(text)
  }, [])

  useEffect(
    () => () => {
      if (sourceTimer.current) window.clearTimeout(sourceTimer.current)
      if (editorTimer.current) window.clearTimeout(editorTimer.current)
    },
    [],
  )

  /** after the surface loads a file: give an open source pane the same text */
  const reseed = useCallback(() => {
    const text = fns.current.serialize()
    syncedRef.current = text
    if (sourceRef.current) sourceRef.current.setValue(text)
    else setSourceSeed(text)
  }, [])

  const setMode = useCallback(
    (next: ViewMode) => {
      const current = modeRef.current
      if (next === current) return
      if (current === 'visual') {
        const text = fns.current.serialize()
        syncedRef.current = text
        setSourceSeed(text)
      } else {
        flushEditor()
        if (sourceRef.current) pendingSourceRef.current = sourceRef.current.getValue()
        flushSource()
      }
      modeRef.current = next
      setModeState(next)
      writePref(`chojema.view.${prefKey}`, next)
    },
    [flushEditor, flushSource, prefKey],
  )

  /** the surface calls this from the visual editor's update handler */
  const onEditorUpdate = useCallback(() => {
    lastPaneRef.current = 'visual'
    if (modeRef.current !== 'split') return
    if (editorTimer.current) window.clearTimeout(editorTimer.current)
    editorTimer.current = window.setTimeout(flushEditor, SYNC_DELAY_MS)
  }, [flushEditor])

  const onSourceChange = useCallback(
    (text: string) => {
      fns.current.onDirty()
      fns.current.onStats(statsOf(text))
      if (modeRef.current !== 'split') {
        pendingSourceRef.current = text
        return
      }
      pendingSourceRef.current = text
      if (sourceTimer.current) window.clearTimeout(sourceTimer.current)
      sourceTimer.current = window.setTimeout(flushSource, SYNC_DELAY_MS)
    },
    [flushSource],
  )

  /** the text a save writes: the source pane when it is open, else the visual editor */
  const getContent = useCallback((): string => {
    if (modeRef.current === 'visual') return fns.current.serialize()
    flushEditor()
    return sourceRef.current?.getValue() ?? syncedRef.current
  }, [flushEditor])

  /** settle pending syncs so the visual editor matches the source (before a save baseline) */
  const settle = useCallback(() => {
    flushEditor()
    if (modeRef.current === 'split') flushSource()
  }, [flushEditor, flushSource])

  return {
    mode,
    setMode,
    sourceSeed,
    sourceRef,
    reseed,
    onEditorUpdate,
    onSourceChange,
    getContent,
    settle,
    lastPaneRef,
  }
}

export type ViewModes = ReturnType<typeof useViewModes>

/** keep two scrolled panes at the same relative position */
function useScrollSync(enabled: boolean, getA: () => HTMLElement | null, getB: () => HTMLElement | null) {
  useEffect(() => {
    if (!enabled) return
    const a = getA()
    const b = getB()
    if (!a || !b) return
    let driver: HTMLElement | null = null
    let release = 0
    const follow = (from: HTMLElement, to: HTMLElement) => () => {
      if (driver && driver !== from) return
      driver = from
      window.clearTimeout(release)
      release = window.setTimeout(() => (driver = null), 80)
      const range = from.scrollHeight - from.clientHeight
      const ratio = range > 0 ? from.scrollTop / range : 0
      to.scrollTop = ratio * (to.scrollHeight - to.clientHeight)
    }
    const fromA = follow(a, b)
    const fromB = follow(b, a)
    a.addEventListener('scroll', fromA, { passive: true })
    b.addEventListener('scroll', fromB, { passive: true })
    return () => {
      a.removeEventListener('scroll', fromA)
      b.removeEventListener('scroll', fromB)
      window.clearTimeout(release)
    }
  }, [enabled, getA, getB])
}

interface PanesProps {
  views: ViewModes
  prefKey: string
  language: CodeLanguage
  wrap: boolean
  /** text size of the source pane, in percent */
  zoom: number
  /** the visual editor's scroll container (receives scroll sync) */
  visualScrollRef: React.RefObject<HTMLDivElement | null>
  /** extra class for the visual scroll container */
  visualClassName?: string
  /** content of the visual pane (the editor canvas) */
  children: ReactNode
  /** shown above the source pane */
  sourceNote?: ReactNode
}

/** source pane, divider and visual pane laid out for the current view mode */
export function Panes({
  views,
  prefKey,
  language,
  wrap,
  zoom,
  visualScrollRef,
  visualClassName,
  children,
  sourceNote,
}: PanesProps) {
  const { mode, sourceSeed, sourceRef, onSourceChange, lastPaneRef } = views
  const [ratio, setRatio] = useState(() => {
    const saved = Number(readPref(`chojema.split.${prefKey}`))
    return saved >= 0.2 && saved <= 0.8 ? saved : 0.5
  })
  const containerRef = useRef<HTMLDivElement>(null)

  const startDrag = (event: React.PointerEvent) => {
    event.preventDefault()
    const box = containerRef.current?.getBoundingClientRect()
    if (!box) return
    const move = (e: PointerEvent) => {
      const next = Math.min(0.8, Math.max(0.2, (e.clientX - box.left) / box.width))
      setRatio(next)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('is-resizing')
      setRatio((value) => {
        writePref(`chojema.split.${prefKey}`, String(value))
        return value
      })
    }
    document.body.classList.add('is-resizing')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const getSource = useCallback(() => sourceRef.current?.scrollElement() ?? null, [sourceRef])
  const getVisual = useCallback(() => visualScrollRef.current, [visualScrollRef])
  // the source editor mounts with the split view, so wait a frame before wiring the listeners
  const [sourceReady, setSourceReady] = useState(false)
  useEffect(() => {
    if (mode !== 'split') {
      setSourceReady(false)
      return
    }
    const id = requestAnimationFrame(() => setSourceReady(true))
    return () => cancelAnimationFrame(id)
  }, [mode])
  useScrollSync(mode === 'split' && sourceReady, getSource, getVisual)

  return (
    <div className={`panes panes-${mode}`} ref={containerRef}>
      {mode !== 'visual' && (
        <div className="pane pane-source" style={mode === 'split' ? { flexBasis: `${ratio * 100}%` } : undefined}>
          {sourceNote}
          <CodeEditor
            ref={sourceRef}
            initialValue={sourceSeed}
            language={language}
            wrap={wrap}
            fontScale={zoom / 100}
            onChange={onSourceChange}
            onFocus={() => (lastPaneRef.current = 'source')}
          />
        </div>
      )}
      {mode === 'split' && (
        <div className="pane-divider" role="separator" aria-orientation="vertical" onPointerDown={startDrag} />
      )}
      <div
        className={`pane pane-visual surface-scroll ${visualClassName ?? ''}`}
        ref={visualScrollRef}
        hidden={mode === 'source'}
        onFocusCapture={() => (lastPaneRef.current = 'visual')}
      >
        {children}
      </div>
    </div>
  )
}
