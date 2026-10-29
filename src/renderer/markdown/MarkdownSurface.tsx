import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { buildExtensions } from '../editor/extensions'
import { buildSlashItems, type SlashController, type SlashMenuState } from '../editor/slashCommand'
import { dirOf, setImageBaseDir } from '../editor/localImage'
import { uiOp } from '../editor/ops'
import { SlashMenu, type SlashMenuHandle } from '../components/SlashMenu'
import { TableMenu } from '../components/TableMenu'
import { Toolbar } from '../components/Toolbar'
import { FindBar } from '../components/FindBar'
import { OutlinePane } from '../components/OutlinePane'
import {
  buildFrontmatterRaw,
  frontmatterInner,
  parseDocText,
  stripLegacyFencedDivs,
  type DocEnvelope,
} from './docText'
import { captureMarkdownSource, serializeMarkdown, type MarkdownSourceSnapshot } from './roundtripSerializer'
import { buildSourceMap, spliceMarkdown, type SourceMap } from './sourceSplice'
import { statsOf, type SurfaceHandle, type SurfaceProps } from '../surface'
import { Panes, useViewModes } from '../views'
import { useOutlinePref } from '../components/useOutlinePref'
import { markdownPage, renderedMarkdownBody, titleFor } from '../exportPage'
import { t } from '../i18n/locale'

/**
 * Markdown visual editor (TipTap) with source and side-by-side views. Saving
 * keeps every block the user did not touch byte-for-byte as it was: the source
 * map pairs blocks with their original text and only edited runs are
 * re-serialized. The same rule makes a visual edit in the split view rewrite
 * only that block in the source pane.
 */
export const MarkdownSurface = forwardRef<SurfaceHandle, SurfaceProps>(function MarkdownSurface(
  { initialContent, path, wrap, zoom, onDirty, onStats, onSave },
  ref,
) {
  const envelopeRef = useRef<DocEnvelope | null>(null)
  const sourceMapRef = useRef<SourceMap | null>(null)
  const originalRef = useRef<MarkdownSourceSnapshot | undefined>(undefined)
  const pathRef = useRef(path)
  pathRef.current = path
  const onDirtyRef = useRef(onDirty)
  onDirtyRef.current = onDirty
  const onStatsRef = useRef(onStats)
  onStatsRef.current = onStats

  const [slashState, setSlashState] = useState<SlashMenuState | null>(null)
  const slashMenuRef = useRef<SlashMenuHandle>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [find, setFind] = useState<{ replace: boolean } | null>(null)
  const [outlineOpen, setOutlineOpen] = useOutlinePref()
  const [fmText, setFmText] = useState('')

  setImageBaseDir(path ? dirOf(path) : null)

  const insertImage = useCallback(() => {
    void (async () => {
      const src = await window.editorApi.pickImage()
      const current = editorRef.current
      if (src && current) uiOp(current, { op: 'insertImage', after: 'selection', src })
    })()
  }, [])

  const extensions = useMemo(() => {
    const controller: SlashController = {
      onOpen: setSlashState,
      onUpdate: setSlashState,
      onKeyDown: (event) => slashMenuRef.current?.handleKey(event) ?? false,
      onClose: () => setSlashState(null),
    }
    return buildExtensions({
      slashController: controller,
      slashItems: () => buildSlashItems({ insertImage: pathRef.current ? insertImage : undefined }),
    })
  }, [insertImage])

  const editorUpdateRef = useRef<() => void>(() => {})
  const editor = useEditor({
    extensions,
    content: '',
    autofocus: true,
    editorProps: { attributes: { class: 'doc-editor', spellcheck: 'false' } },
    onUpdate: ({ editor: updated, transaction }) => {
      if (transaction.getMeta('uiOnly')) return
      onDirtyRef.current()
      onStatsRef.current(statsOf(updated.getText()))
      editorUpdateRef.current()
    },
  })
  const editorRef = useRef<Editor | null>(null)
  editorRef.current = editor

  /** put file text on the canvas; the first load is neither undoable nor an edit */
  const load = useCallback(
    (raw: string, undoable: boolean) => {
      if (!editor) return
      const envelope = parseDocText(raw)
      envelopeRef.current = envelope
      const body = stripLegacyFencedDivs(envelope.body)
      const chain = editor.chain().setMeta('addToHistory', undoable)
      chain.setContent(body, { contentType: 'markdown', emitUpdate: false })
      if (!undoable) chain.setTextSelection(1)
      chain.run()
      sourceMapRef.current = buildSourceMap(editor, editor.state.doc, body)
      originalRef.current = captureMarkdownSource(raw, envelope, editor.state.doc)
      setFmText(frontmatterInner(envelope.frontmatter))
      onStatsRef.current(statsOf(editor.getText()))
    },
    [editor],
  )

  const serialize = useCallback((): string => {
    if (!editor || !envelopeRef.current) return initialContent
    const map = sourceMapRef.current
    return serializeMarkdown(
      envelopeRef.current,
      editor.state.doc,
      () => (map ? spliceMarkdown(editor, editor.state.doc, map) : editor.getMarkdown()),
      originalRef.current,
    )
  }, [editor, initialContent])

  const views = useViewModes({ prefKey: 'markdown', serialize, load, onDirty, onStats })
  editorUpdateRef.current = views.onEditorUpdate

  useEffect(() => {
    if (!editor) return
    load(initialContent, false)
    views.reseed()
    // the initial text is loaded once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  /** frontmatter edits go straight into the envelope; the body is untouched */
  const editFrontmatter = (inner: string) => {
    setFmText(inner)
    const envelope = envelopeRef.current
    if (!envelope) return
    envelopeRef.current = { ...envelope, frontmatter: buildFrontmatterRaw(inner) }
    onDirty()
    views.onEditorUpdate()
  }

  useImperativeHandle(
    ref,
    () => ({
      getContent: views.getContent,
      markSaved(content) {
        if (views.mode === 'source' || !editor || !envelopeRef.current) return
        views.settle()
        // the saved text is the new disk baseline the next save splices against
        const envelope = parseDocText(content)
        envelopeRef.current = envelope
        sourceMapRef.current = buildSourceMap(editor, editor.state.doc, envelope.body)
        originalRef.current = captureMarkdownSource(content, envelope, editor.state.doc)
      },
      setMode: views.setMode,
      toggleSource: () => views.setMode(views.mode === 'source' ? 'visual' : 'source'),
      openFind(withReplace) {
        if (views.mode === 'source' || (views.mode === 'split' && views.lastPaneRef.current === 'source')) {
          views.sourceRef.current?.openFind()
        } else setFind({ replace: withReplace })
      },
      toggleOutline: () => setOutlineOpen(!outlineOpen),
      async exportPage() {
        views.settle()
        const body = editor ? await renderedMarkdownBody(editor) : ''
        return { html: markdownPage(body, titleFor(editor, path)), baseDir: path ? dirOf(path) : null }
      },
      async richCopy() {
        views.settle()
        const html = editor ? await renderedMarkdownBody(editor) : ''
        return { html, text: editor?.getText({ blockSeparator: '\n\n' }) ?? '' }
      },
    }),
    [views, editor, outlineOpen, setOutlineOpen, path],
  )

  const showOutline = outlineOpen && views.mode !== 'source' && editor

  return (
    <div className="surface">
      <Toolbar
        editor={editor}
        kind="markdown"
        mode={views.mode}
        onMode={views.setMode}
        outlineOpen={outlineOpen}
        onToggleOutline={() => setOutlineOpen(!outlineOpen)}
        onSave={onSave}
        onInsertImage={insertImage}
      />
      {find && editor && views.mode !== 'source' && (
        <FindBar editor={editor} withReplace={find.replace} onClose={() => setFind(null)} />
      )}
      <div className="surface-body">
        {showOutline && <OutlinePane editor={editor} />}
        <Panes
          views={views}
          prefKey="markdown"
          language="markdown"
          wrap={wrap}
          visualScrollRef={scrollRef}
        >
          <div className="doc-page" style={{ zoom: zoom / 100 }}>
            {fmText && (
              <details className="frontmatter" open>
                <summary title={t('frontmatterHint')}>{t('frontmatter')}</summary>
                <textarea
                  className="frontmatter-input"
                  value={fmText}
                  spellCheck={false}
                  rows={Math.min(12, fmText.split('\n').length + 1)}
                  onChange={(event) => editFrontmatter(event.target.value)}
                />
              </details>
            )}
            <EditorContent editor={editor} />
          </div>
        </Panes>
      </div>
      <SlashMenu ref={slashMenuRef} state={slashState} onDismiss={() => setSlashState(null)} />
      {views.mode !== 'source' && <TableMenu editor={editor} scrollRef={scrollRef} zoom={zoom} />}
    </div>
  )
})
