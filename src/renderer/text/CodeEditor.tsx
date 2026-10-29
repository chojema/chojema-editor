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
  setValue(text: string): void
  focus(): void
  openFind(): void
}

interface Props {
  initialValue: string
  language: CodeLanguage
  wrap: boolean
  placeholder?: string
  onChange?: (text: string) => void
  onStats?: (stats: { lines: number; chars: number }) => void
}

function languageExtension(language: CodeLanguage): Extension {
  if (language === 'markdown') return markdown()
  if (language === 'html') return html()
  return []
}

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '14px', backgroundColor: 'var(--surface)', color: 'var(--text)' },
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
  { initialValue, language, wrap, placeholder, onChange, onStats },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const wrapCompartment = useRef(new Compartment())
  const onChangeRef = useRef(onChange)
  const onStatsRef = useRef(onStats)
  onChangeRef.current = onChange
  onStatsRef.current = onStats

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
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return
          report(update.state)
          // a programmatic setValue is not a user edit
          if (update.transactions.some((tr) => tr.annotation(programmatic))) return
          onChangeRef.current?.(update.state.doc.toString())
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

  useImperativeHandle(ref, () => ({
    getValue: () => viewRef.current?.state.doc.toString() ?? '',
    setValue(text) {
      const view = viewRef.current
      if (!view) return
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        annotations: programmatic.of(true),
      })
    },
    focus: () => viewRef.current?.focus(),
    openFind() {
      const view = viewRef.current
      if (view) openSearchPanel(view)
    },
  }))

  return <div className="code-host" ref={hostRef} />
})
