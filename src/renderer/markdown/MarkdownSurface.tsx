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
import { CodeEditor, type CodeEditorHandle } from '../text/CodeEditor'
import { parseDocText, stripLegacyFencedDivs, type DocEnvelope } from './docText'
import { captureMarkdownSource, serializeMarkdown, type MarkdownSourceSnapshot } from './roundtripSerializer'
import { buildSourceMap, spliceMarkdown, type SourceMap } from './sourceSplice'
import { statsOf, type SurfaceHandle, type SurfaceProps } from '../surface'
import { t } from '../i18n/locale'

/**
 * Markdown visual editor (TipTap) with a source view. Saving keeps every
 * block the user did not touch byte-for-byte as it was on disk: the source
 * map pairs blocks with their original text and only edited runs are
 * re-serialized.
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
  const [sourceMode, setSourceMode] = useState(false)
  const [sourceSeed, setSourceSeed] = useState('')
  const sourceRef = useRef<CodeEditorHandle>(null)
  const [findOpen, setFindOpen] = useState(false)

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

  const editor = useEditor({
    extensions,
    content: '',
    autofocus: true,
    editorProps: { attributes: { class: 'doc-editor', spellcheck: 'false' } },
    onUpdate: ({ editor: updated, transaction }) => {
      if (!transaction.getMeta('uiOnly')) onDirtyRef.current()
      onStatsRef.current(statsOf(updated.getText()))
    },
  })
  const editorRef = useRef<Editor | null>(null)
  editorRef.current = editor

  /** put file text on the canvas; the load itself is neither undoable nor an edit */
  const load = useCallback(
    (raw: string) => {
      if (!editor) return
      const envelope = parseDocText(raw)
      envelopeRef.current = envelope
      const body = stripLegacyFencedDivs(envelope.body)
      editor
        .chain()
        .setMeta('addToHistory', false)
        .setContent(body, { contentType: 'markdown', emitUpdate: false })
        .setTextSelection(1)
        .run()
      sourceMapRef.current = buildSourceMap(editor, editor.state.doc, body)
      originalRef.current = captureMarkdownSource(raw, envelope, editor.state.doc)
      onStatsRef.current(statsOf(editor.getText()))
    },
    [editor],
  )

  useEffect(() => {
    load(initialContent)
    // the initial text is loaded once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

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

  const toggleSource = useCallback(() => {
    if (!sourceMode) {
      setSourceSeed(serialize())
      setFindOpen(false)
      setSourceMode(true)
      return
    }
    const text = sourceRef.current?.getValue() ?? sourceSeed
    if (text !== sourceSeed) load(text)
    setSourceMode(false)
    requestAnimationFrame(() => editor?.commands.focus())
  }, [sourceMode, sourceSeed, serialize, load, editor])

  useImperativeHandle(
    ref,
    () => ({
      getContent: () => (sourceMode ? (sourceRef.current?.getValue() ?? sourceSeed) : serialize()),
      markSaved(content) {
        // in the source view the canvas is rebuilt from the text on the way back
        if (sourceMode || !editor || !envelopeRef.current) return
        // the saved text is the new disk baseline the next save splices against
        sourceMapRef.current = buildSourceMap(editor, editor.state.doc, parseDocText(content).body)
        originalRef.current = captureMarkdownSource(content, envelopeRef.current, editor.state.doc)
      },
      toggleSource,
      openFind() {
        if (sourceMode) sourceRef.current?.openFind()
        else setFindOpen(true)
      },
    }),
    [sourceMode, sourceSeed, serialize, toggleSource, editor],
  )

  return (
    <div className="surface">
      <Toolbar
        editor={editor}
        kind="markdown"
        sourceMode={sourceMode}
        onToggleSource={toggleSource}
        onSave={onSave}
        onInsertImage={insertImage}
      />
      {findOpen && editor && !sourceMode && <FindBar editor={editor} onClose={() => setFindOpen(false)} />}
      {sourceMode && (
        <div className="surface-source">
          <div className="source-note">{t('sourceParseNote')}</div>
          <CodeEditor
            ref={sourceRef}
            initialValue={sourceSeed}
            language="markdown"
            wrap={wrap}
            onChange={(text) => {
              onDirty()
              onStats(statsOf(text))
            }}
          />
        </div>
      )}
      <div className="surface-scroll" ref={scrollRef} hidden={sourceMode}>
        <div className="doc-page" style={{ zoom: zoom / 100 }}>
          <EditorContent editor={editor} />
        </div>
      </div>
      <SlashMenu ref={slashMenuRef} state={slashState} onDismiss={() => setSlashState(null)} />
      {!sourceMode && <TableMenu editor={editor} scrollRef={scrollRef} zoom={zoom} />}
    </div>
  )
})
