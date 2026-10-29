import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { Node as PmNode } from '@tiptap/pm/model'
import { EditorContent, useEditor } from '@tiptap/react'
import { dirOf, resolveImageSrc, setImageBaseDir } from '../editor/localImage'
import { TableMenu } from '../components/TableMenu'
import { Toolbar } from '../components/Toolbar'
import { FindBar } from '../components/FindBar'
import { CodeEditor, type CodeEditorHandle } from '../text/CodeEditor'
import { statsOf, type SurfaceHandle, type SurfaceProps } from '../surface'
import { t } from '../i18n/locale'
import { buildHtmlExtensions } from './htmlExtensions'
import {
  collectStyleSources,
  NEW_HTML_DOCUMENT,
  parseHtmlDocument,
  serializeHtmlDocument,
  cleanSerializedHtml,
  type HtmlEnvelope,
} from './htmlDocument'
import { scopeCss } from './scopeCss'
import { RAW_HTML_EDIT_EVENT, type RawHtmlEditDetail } from './rawHtml'
import { BARE_ATTR } from './preserve'

const CANVAS = 'html-canvas'
const SCOPE = `.${CANVAS}`

function joinPath(dir: string, rel: string): string {
  const parts = `${dir.replace(/\\/g, '/')}/${rel}`.split('/')
  const out: string[] = []
  for (const part of parts) {
    if (part === '..') out.pop()
    else if (part !== '.' && part !== '') out.push(part)
  }
  return `${/^[a-zA-Z]:/.test(out[0] ?? '') ? '' : '/'}${out.join('/')}`
}

/** the document's own CSS, confined to the canvas, so the page looks as it does in a browser */
async function buildDocumentCss(source: string, path: string | null): Promise<string> {
  const docDir = path ? dirOf(path) : null
  const chunks: string[] = []
  for (const style of collectStyleSources(source)) {
    if (style.css !== null) {
      chunks.push(scopeCss(style.css, SCOPE, (rel) => resolveImageSrc(rel)))
      continue
    }
    const href = style.href!
    try {
      if (/^https?:\/\//i.test(href)) {
        const css = await (await fetch(href)).text()
        const base = href.slice(0, href.lastIndexOf('/') + 1)
        chunks.push(scopeCss(css, SCOPE, (rel) => new URL(rel, base).toString()))
      } else if (docDir) {
        const css = await window.editorApi.readAsset(href)
        if (css === null) continue
        const cssDir = dirOf(joinPath(docDir, href))
        chunks.push(scopeCss(css, SCOPE, (rel) => resolveImageSrc(joinPath(cssDir, rel), null)))
      }
    } catch {
      // an unreachable stylesheet leaves the page unstyled by it, nothing more
    }
  }
  return chunks.join('\n')
}

interface Original {
  raw: string
  doc: PmNode
}

/**
 * HTML visual editor. Only the inside of <body> is edited; the head and the
 * body tag are kept verbatim, and the document's stylesheets are applied to
 * the canvas so what you edit is what the browser shows.
 */
export const HtmlSurface = forwardRef<SurfaceHandle, SurfaceProps>(function HtmlSurface(
  { initialContent, path, wrap, zoom, onDirty, onStats, onSave },
  ref,
) {
  const startText = initialContent || NEW_HTML_DOCUMENT
  const [envelope, setEnvelope] = useState<HtmlEnvelope>(() => parseHtmlDocument(startText))
  const envelopeRef = useRef(envelope)
  envelopeRef.current = envelope
  const originalRef = useRef<Original | null>(null)
  const onDirtyRef = useRef(onDirty)
  onDirtyRef.current = onDirty
  const onStatsRef = useRef(onStats)
  onStatsRef.current = onStats

  const scrollRef = useRef<HTMLDivElement>(null)
  const [sourceMode, setSourceMode] = useState(false)
  const [sourceSeed, setSourceSeed] = useState('')
  const sourceRef = useRef<CodeEditorHandle>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [rawEdit, setRawEdit] = useState<RawHtmlEditDetail | null>(null)

  setImageBaseDir(path ? dirOf(path) : null)

  const extensions = useMemo(() => buildHtmlExtensions(), [])

  const canvasAttributes = useMemo(() => {
    const { class: bodyClass, style, ...rest } = envelope.bodyAttrs
    const keep = Object.fromEntries(Object.entries(rest).filter(([name]) => !/^on/i.test(name)))
    return {
      ...keep,
      class: [CANVAS, bodyClass].filter(Boolean).join(' '),
      ...(style ? { style } : {}),
      spellcheck: 'false',
    }
  }, [envelope.bodyAttrs])

  const editor = useEditor({
    extensions,
    content: '',
    autofocus: true,
    editorProps: { attributes: canvasAttributes },
    onUpdate: ({ editor: updated }) => {
      onDirtyRef.current()
      onStatsRef.current(statsOf(updated.getText()))
    },
  })

  useEffect(() => {
    editor?.setOptions({ editorProps: { attributes: canvasAttributes } })
  }, [editor, canvasAttributes])

  const load = useCallback(
    (raw: string) => {
      if (!editor) return
      const next = parseHtmlDocument(raw)
      setEnvelope(next)
      envelopeRef.current = next
      editor
        .chain()
        .setMeta('addToHistory', false)
        .setContent(next.body, { emitUpdate: false })
        .run()
      originalRef.current = { raw, doc: editor.state.doc }
      onStatsRef.current(statsOf(editor.getText()))
    },
    [editor],
  )

  useEffect(() => {
    // an untitled document starts from the template, which is not an edit
    load(startText)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  // the document's stylesheets follow the head (and any inline <style> in the body)
  const [documentCss, setDocumentCss] = useState('')
  useEffect(() => {
    let alive = true
    void buildDocumentCss(`${envelope.prefix}${envelope.body}`, path).then((css) => {
      if (alive) setDocumentCss(css)
    })
    return () => {
      alive = false
    }
  }, [envelope.prefix, envelope.body, path])

  const serialize = useCallback((): string => {
    if (!editor) return startText
    const original = originalRef.current
    if (original && editor.state.doc.eq(original.doc)) return original.raw
    return serializeHtmlDocument(envelopeRef.current, cleanSerializedHtml(editor.getHTML(), BARE_ATTR))
  }, [editor, startText])

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

  const insertImage = useCallback(() => {
    void (async () => {
      const src = await window.editorApi.pickImage()
      if (src && editor) editor.chain().focus().setImage({ src }).run()
    })()
  }, [editor])

  useEffect(() => {
    const open = (event: Event) => setRawEdit((event as CustomEvent<RawHtmlEditDetail>).detail)
    window.addEventListener(RAW_HTML_EDIT_EVENT, open)
    return () => window.removeEventListener(RAW_HTML_EDIT_EVENT, open)
  }, [])

  const applyRawEdit = (html: string) => {
    if (!editor || !rawEdit) return
    const { pos } = rawEdit
    const node = editor.state.doc.nodeAt(pos)
    setRawEdit(null)
    if (!node) return
    const trimmed = html.trim()
    const tr = editor.state.tr
    if (!trimmed) tr.delete(pos, pos + node.nodeSize)
    else {
      const tag = /^<([a-zA-Z][\w-]*)/.exec(trimmed)?.[1]?.toLowerCase() ?? String(node.attrs.tag)
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, html: trimmed, tag })
    }
    editor.view.dispatch(tr)
    editor.commands.focus()
  }

  useImperativeHandle(
    ref,
    () => ({
      getContent: () => (sourceMode ? (sourceRef.current?.getValue() ?? sourceSeed) : serialize()),
      markSaved(content) {
        if (sourceMode || !editor) return
        originalRef.current = { raw: content, doc: editor.state.doc }
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
      <style>{documentCss}</style>
      <Toolbar
        editor={editor}
        kind="html"
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
            language="html"
            wrap={wrap}
            onChange={(text) => {
              onDirty()
              onStats(statsOf(text))
            }}
          />
        </div>
      )}
      <div className="surface-scroll html-scroll" ref={scrollRef} hidden={sourceMode}>
        <div className="html-page" style={{ zoom: zoom / 100 }}>
          <EditorContent editor={editor} />
        </div>
      </div>
      {!sourceMode && <TableMenu editor={editor} scrollRef={scrollRef} zoom={zoom} />}
      {rawEdit && (
        <RawHtmlDialog html={rawEdit.html} onApply={applyRawEdit} onCancel={() => setRawEdit(null)} />
      )}
    </div>
  )
})

function RawHtmlDialog({
  html,
  onApply,
  onCancel,
}: {
  html: string
  onApply: (html: string) => void
  onCancel: () => void
}) {
  const codeRef = useRef<CodeEditorHandle>(null)
  return (
    <div
      className="modal-backdrop"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel()
      }}
    >
      <div className="modal" role="dialog" aria-label={t('rawHtmlEditTitle')}>
        <div className="modal-title">{t('rawHtmlEditTitle')}</div>
        <div className="modal-code">
          <CodeEditor ref={codeRef} initialValue={html} language="html" wrap />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel}>
            {t('cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onApply(codeRef.current?.getValue() ?? html)}
          >
            {t('apply')}
          </button>
        </div>
      </div>
    </div>
  )
}
