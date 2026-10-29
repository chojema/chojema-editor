import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { closeBrackets } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { html } from '@codemirror/lang-html'
import { markdown } from '@codemirror/lang-markdown'
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language'
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from '@codemirror/search'
import { Annotation, Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as placeholderExt,
} from '@codemirror/view'

/** marks setValue transactions so they are not reported as user edits */
const programmatic = Annotation.define<boolean>()

export type CodeLanguage = 'text' | 'markdown' | 'html'

export interface CodeEditorHandle {
  getValue(): string
  /** replace the text, touching only the changed middle so the view does not jump */
  setValue(text: string): void
  focus(): void
  hasFocus(): boolean
  openFind(): void
  scrollElement(): HTMLElement | null
}

interface Props {
  initialValue: string
  language: CodeLanguage
  wrap: boolean
  placeholder?: string
  onChange?: (text: string) => void
  onStats?: (stats: { lines: number; chars: number }) => void
  onFocus?: () => void
  /** text size relative to the 14px default (1 = 100%) */
  fontScale?: number
}

const BASE_FONT_PX = 14

function fontTheme(scale: number): Extension {
  return EditorView.theme({ '&': { fontSize: `${Math.round(BASE_FONT_PX * scale * 10) / 10}px` } })
}

function languageExtension(language: CodeLanguage): Extension {
  if (language === 'markdown') return markdown()
  if (language === 'html') return html()
  return []
}

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--surface)', color: 'var(--text)' },
  '.cm-scroller': {
    fontFamily: "'SF Mono', Menlo, Consolas, 'D2Coding', monospace",
    lineHeight: '1.6',
  },
  '.cm-content': { caretColor: 'var(--text)', padding: '12px 0' },
  '.cm-gutters': {
    backgroundColor: 'var(--surface)',
    color: 'var(--text-muted)',
    borderRight: '1px solid var(--border)',
  },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent) 6%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--accent) 10%, transparent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 28%, transparent) !important',
  },
  '.cm-panels': { backgroundColor: 'var(--surface)', color: 'var(--text)' },
})

/** CodeMirror 6 host used for plain text files and for the Markdown/HTML source views */
export const CodeEditor = forwardRef<CodeEditorHandle, Props>(function CodeEditor(
  { initialValue, language, wrap, placeholder, onChange, onStats, onFocus, fontScale = 1 },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const wrapCompartment = useRef(new Compartment())
  const fontCompartment = useRef(new Compartment())
  const onChangeRef = useRef(onChange)
  const onStatsRef = useRef(onStats)
  onChangeRef.current = onChange
  onStatsRef.current = onStats
  const onFocusRef = useRef(onFocus)
  onFocusRef.current = onFocus
  // CodeMirror keeps "\n" internally; a CRLF file gets its line endings back on the way out
  const crlfRef = useRef(initialValue.includes('\r\n'))
  const withEol = (text: string) => (crlfRef.current ? text.replace(/\n/g, '\r\n') : text)

  useEffect(() => {
    const report = (state: EditorState) =>
      onStatsRef.current?.({ lines: state.doc.lines, chars: state.doc.length })
    const state = EditorState.create({
      doc: initialValue,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        foldGutter(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        search({ top: true }),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        languageExtension(language),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        wrapCompartment.current.of(wrap ? EditorView.lineWrapping : []),
        placeholder ? placeholderExt(placeholder) : [],
        theme,
        fontCompartment.current.of(fontTheme(fontScale)),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return
          report(update.state)
          // a programmatic setValue is not a user edit
          if (update.transactions.some((tr) => tr.annotation(programmatic))) return
          onChangeRef.current?.(withEol(update.state.doc.toString()))
        }),
        EditorView.domEventHandlers({
          focus: () => {
            onFocusRef.current?.()
          },
        }),
      ],
    })
    const view = new EditorView({ state, parent: hostRef.current! })
    viewRef.current = view
    report(state)
    view.focus()
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // the document is created once; later text arrives through setValue
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language])

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: wrapCompartment.current.reconfigure(wrap ? EditorView.lineWrapping : []),
    })
  }, [wrap])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: fontCompartment.current.reconfigure(fontTheme(fontScale)) })
  }, [fontScale])

  useImperativeHandle(ref, () => ({
    getValue: () => withEol(viewRef.current?.state.doc.toString() ?? ''),
    setValue(text) {
      const view = viewRef.current
      if (!view) return
      crlfRef.current = text.includes('\r\n')
      const next = text.replace(/\r\n/g, '\n')
      const current = view.state.doc.toString()
      if (next === current) return
      let start = 0
      while (start < current.length && start < next.length && current[start] === next[start]) start++
      let endCur = current.length
      let endNext = next.length
      while (endCur > start && endNext > start && current[endCur - 1] === next[endNext - 1]) {
        endCur--
        endNext--
      }
      view.dispatch({
        changes: { from: start, to: endCur, insert: next.slice(start, endNext) },
        annotations: programmatic.of(true),
      })
    },
    focus: () => viewRef.current?.focus(),
    hasFocus: () => viewRef.current?.hasFocus ?? false,
    scrollElement: () => viewRef.current?.scrollDOM ?? null,
    openFind() {
      const view = viewRef.current
      if (view) openSearchPanel(view)
    },
  }))

  return <div className="code-host" ref={hostRef} />
})
