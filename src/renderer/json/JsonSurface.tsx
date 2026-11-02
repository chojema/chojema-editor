import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { ViewModeSwitch } from '../components/Toolbar'
import { showToast } from '../components/toast-bus'
import { textPage } from '../exportPage'
import { t } from '../i18n/locale'
import { statsOf, type SurfaceHandle, type SurfaceProps } from '../surface'
import { Panes, useViewModes, type ViewMode } from '../views'
import {
  formatJson,
  lineColumn,
  minifyJson,
  parseJson,
  pathKey,
  remapPaths,
  sortJsonKeys,
  type JsonNode,
} from './jsonDoc'
import { jsonErrorText } from './jsonLint'
import { expandablePaths, findMatches, initialExpanded, JsonTree, type ExpandedChange } from './JsonTree'

const NEW_JSON_DOCUMENT = '{}\n'
const MAX_UNDO = 200

/**
 * JSON tree editor with source and side-by-side views. The text is the document
 * (see jsonDoc.ts); the tree is a view of it, and a file saved without edits
 * keeps every byte.
 */
export const JsonSurface = forwardRef<SurfaceHandle, SurfaceProps>(function JsonSurface(
  { initialContent, path, wrap, zoom, autoComplete, onDirty, onStats },
  ref,
) {
  const startText = initialContent || NEW_JSON_DOCUMENT
  const [text, setTextState] = useState(startText)
  const textRef = useRef(startText)
  const parsed = useMemo(() => parseJson(text), [text])
  // while the source does not parse, the tree keeps its last good state, read-only
  const lastGood = useRef<{ text: string; root: JsonNode } | null>(null)
  if (parsed.root) lastGood.current = { text, root: parsed.root }
  const shown = lastGood.current
  const [expanded, setExpanded] = useState<Set<string>>(() => initialExpanded(parsed.root))
  const undoStack = useRef<string[]>([])
  const redoStack = useRef<string[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const [find, setFind] = useState<{ query: string; at: number } | null>(null)
  const findInputRef = useRef<HTMLInputElement>(null)

  const setText = useCallback((next: string) => {
    textRef.current = next
    setTextState(next)
  }, [])

  const remember = useCallback(() => {
    undoStack.current.push(textRef.current)
    if (undoStack.current.length > MAX_UNDO) undoStack.current.shift()
    redoStack.current = []
  }, [])

  const load = useCallback(
    (raw: string, undoable: boolean) => {
      if (raw === textRef.current) return
      if (undoable) remember()
      setText(raw)
    },
    [remember, setText],
  )
  const serialize = useCallback(() => textRef.current, [])

  const views = useViewModes({ prefKey: 'json', serialize, load, onDirty, onStats, initialSource: startText })

  useEffect(() => onStats(statsOf(text)), [text, onStats])

  const editFromTree = useCallback(
    (next: string) => {
      if (next === textRef.current) return
      remember()
      setText(next)
      onDirty()
      views.onEditorUpdate()
    },
    [onDirty, remember, setText, views],
  )

  const step = useCallback(
    (from: { current: string[] }, to: { current: string[] }) => {
      const next = from.current.pop()
      if (next === undefined) return
      to.current.push(textRef.current)
      setText(next)
      onDirty()
      views.onEditorUpdate()
    },
    [onDirty, setText, views],
  )
  const undo = useCallback(() => step(undoStack, redoStack), [step])
  const redo = useCallback(() => step(redoStack, undoStack), [step])

  const history = (direction: 'undo' | 'redo') => {
    if (views.mode === 'source' || views.lastPaneRef.current === 'source') views.sourceHistory(direction)
    else { views.activate('visual'); (direction === 'undo' ? undo : redo)() }
  }

  // Save/export shortcuts run before a text field blurs. Commit that field
  // synchronously so the snapshot contains the value currently being typed.
  const getContent = () => {
    const field = document.activeElement
    if (field instanceof HTMLTextAreaElement && scrollRef.current?.contains(field)) field.blur()
    return views.getContent()
  }

  // the tree has no native undo; fields and the source pane keep their own
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || views.mode === 'source') return
      const target = event.target as HTMLElement
      if (target.closest('input, textarea, select, .cm-editor')) return
      const key = event.key.toLowerCase()
      if (key === 'z' && !event.shiftKey) undo()
      else if ((key === 'z' && event.shiftKey) || key === 'y') redo()
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, views.mode])

  const onShift = useCallback((parent: readonly number[], remap: (index: number) => number | null) => {
    setExpanded((keys) => remapPaths(keys, parent, remap))
  }, [])
  const onExpanded = useCallback<ExpandedChange>((change) => setExpanded((keys) => change(keys)), [])

  /** run a whole-document rewrite from whichever pane holds the latest text */
  const rewrite = (change: (text: string, root: JsonNode) => string) => {
    views.settle()
    const current = textRef.current
    const result = parseJson(current)
    if (!result.root) {
      const { line, column } = lineColumn(current, result.error.offset)
      showToast(t('jsonCannotRewrite', { line, column, error: jsonErrorText(result.error.code) }), 'error')
      return
    }
    const next = change(current, result.root)
    if (next === current) return
    load(next, true)
    views.reseed()
    onDirty()
  }

  // the source pane mounts with the mode change, so an action on it waits for that commit
  const afterModeChange = useRef<(() => void) | null>(null)
  useEffect(() => {
    afterModeChange.current?.()
    afterModeChange.current = null
  }, [views.mode])
  const inSourcePane = (action: () => void) => {
    if (views.mode !== 'visual') {
      action()
      return
    }
    afterModeChange.current = action
    views.setMode('source')
  }

  const goToError = (line: number, column: number) => {
    inSourcePane(() => views.sourceRef.current?.goTo(line, column))
  }

  const setMode = (mode: ViewMode) => views.setMode(mode)

  const matches = useMemo(
    () => (find && shown ? findMatches(shown.text, shown.root, find.query) : []),
    [find?.query, shown], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const matchPaths = useMemo(() => new Set(matches.map((m) => pathKey(m.path))), [matches])
  const current = find && matches.length > 0 ? matches[Math.min(find.at, matches.length - 1)]!.path : null
  const currentKey = current ? pathKey(current) : null

  // the rows above the current match must be open for it to show
  useEffect(() => {
    if (!current) return
    setExpanded((keys) => {
      const missing = current.map((_, depth) => pathKey(current.slice(0, depth))).filter((key) => !keys.has(key))
      return missing.length ? new Set([...keys, ...missing]) : keys
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey])

  const stepFind = (delta: number) => {
    if (matches.length === 0) return
    setFind((old) => old && { ...old, at: (Math.min(old.at, matches.length - 1) + delta + matches.length) % matches.length })
  }

  useImperativeHandle(
    ref,
    () => ({
      getContent,
      undo: () => history('undo'),
      redo: () => history('redo'),
      markSaved() {
        views.settle()
      },
      setMode: views.setMode,
      toggleSource: () => views.setMode(views.mode === 'source' ? 'visual' : 'source'),
      openFind(withReplace) {
        const inSource = views.mode === 'source' || (views.mode === 'split' && views.lastPaneRef.current === 'source')
        // replacing works on the text, which the source pane's search panel edits
        if (inSource || (views.mode === 'split' && withReplace)) {
          views.sourceRef.current?.openFind()
          return
        }
        if (withReplace) {
          inSourcePane(() => views.sourceRef.current?.openFind())
          return
        }
        setFind((old) => old ?? { query: '', at: 0 })
        requestAnimationFrame(() => findInputRef.current?.select())
      },
      // JSON has no headings to outline
      toggleOutline: () => {},
      exportPage: async () => ({ html: textPage(getContent(), title(path)), baseDir: null }),
      richCopy: async () => {
        const text = getContent()
        const page = textPage(text, title(path))
        return { html: page.slice(page.indexOf('<pre>'), page.indexOf('</pre>') + 6), text }
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [views, path],
  )

  const errorAt = parsed.error ? lineColumn(text, parsed.error.offset) : null
  const inSourceOnly = views.mode === 'source'

  return (
    <div className="surface">
      <div className="toolbar" role="toolbar">
        <button type="button" className="tb-btn" title={t('undo')} aria-label={t('undo')} disabled={views.activePane === 'source' ? !views.sourceSelection.canUndo : undoStack.current.length === 0} onMouseDown={e => e.preventDefault()} onClick={() => history('undo')}>
          ↶
        </button>
        <button type="button" className="tb-btn" title={t('redo')} aria-label={t('redo')} disabled={views.activePane === 'source' ? !views.sourceSelection.canRedo : redoStack.current.length === 0} onMouseDown={e => e.preventDefault()} onClick={() => history('redo')}>
          ↷
        </button>
        <span className="tb-sep" aria-hidden />
        <button type="button" className="tb-btn json-tb-text" title={t('jsonFormatTip')} onClick={() => rewrite(formatJson)}>
          {t('jsonFormat')}
        </button>
        <button type="button" className="tb-btn json-tb-text" title={t('jsonMinifyTip')} onClick={() => rewrite(minifyJson)}>
          {t('jsonMinify')}
        </button>
        <button type="button" className="tb-btn json-tb-text" title={t('jsonSortTip')} onClick={() => rewrite(sortJsonKeys)}>
          {t('jsonSort')}
        </button>
        {!inSourceOnly && (
          <>
            <span className="tb-sep" aria-hidden />
            <button
              type="button"
              className="tb-btn json-tb-text"
              disabled={!shown}
              onClick={() => shown && setExpanded(expandablePaths(shown.root))}
            >
              {t('jsonExpandAll')}
            </button>
            <button type="button" className="tb-btn json-tb-text" disabled={!shown} onClick={() => setExpanded(new Set())}>
              {t('jsonCollapseAll')}
            </button>
          </>
        )}
        <span className="tb-spacer" />
        <ViewModeSwitch mode={views.mode} onMode={setMode} kind="json" />
      </div>
      {find && !inSourceOnly && (
        <div className="json-find" role="search">
          <input
            ref={findInputRef}
            className="tb-input"
            autoFocus
            placeholder={t('jsonFindPlaceholder')}
            aria-label={t('jsonFindPlaceholder')}
            value={find.query}
            onChange={(event) => setFind({ query: event.target.value, at: 0 })}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'Enter') {
                event.preventDefault()
                stepFind(event.shiftKey ? -1 : 1)
              } else if (event.key === 'Escape') setFind(null)
            }}
          />
          <span className="json-find-count">
            {find.query ? t('jsonFindCount', { at: matches.length ? Math.min(find.at, matches.length - 1) + 1 : 0, n: matches.length }) : ''}
          </span>
          <button type="button" className="tb-btn" aria-label={t('jsonFindPrev')} title={t('jsonFindPrev')} onClick={() => stepFind(-1)}>↑</button>
          <button type="button" className="tb-btn" aria-label={t('jsonFindNext')} title={t('jsonFindNext')} onClick={() => stepFind(1)}>↓</button>
          <button type="button" className="tb-btn" aria-label={t('findClose')} title={t('findClose')} onClick={() => setFind(null)}>×</button>
        </div>
      )}
      {parsed.error && errorAt && !inSourceOnly && (
        <div className="json-error" role="alert">
          <span>{t('jsonErrorAt', { line: errorAt.line, column: errorAt.column, error: jsonErrorText(parsed.error.code) })}</span>
          <button type="button" className="tb-text-btn" onClick={() => goToError(errorAt.line, errorAt.column)}>
            {t('jsonGoToError')}
          </button>
        </div>
      )}
      <div className="surface-body">
        <Panes
          views={views}
          prefKey="json"
          language="json"
          wrap={wrap}
          zoom={zoom}
          completion={autoComplete}
          visualScrollRef={scrollRef}
          visualClassName="json-scroll"
        >
          <div style={{ zoom: zoom / 100 }}>
            {shown && (
              <JsonTree
                text={shown.text}
                root={shown.root}
                readOnly={parsed.error !== null}
                expanded={expanded}
                onExpanded={onExpanded}
                onEdit={editFromTree}
                onShift={onShift}
                matchPaths={matchPaths}
                currentMatch={current}
              />
            )}
          </div>
        </Panes>
      </div>
    </div>
  )
})

const title = (path: string | null) => path?.split(/[\\/]/).pop() ?? 'Untitled'
