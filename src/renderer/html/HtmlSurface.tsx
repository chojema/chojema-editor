import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { Node as PmNode } from '@tiptap/pm/model'
import { EditorContent, useEditor } from '@tiptap/react'
import { dirOf, resolveImageSrc, setImageBaseDir } from '../editor/localImage'
import { TableMenu } from '../components/TableMenu'
import { Toolbar } from '../components/Toolbar'
import { FindBar } from '../components/FindBar'
import { OutlinePane } from '../components/OutlinePane'
import { useOutlinePref } from '../components/useOutlinePref'
import { CodeEditor, type CodeEditorHandle } from '../text/CodeEditor'
import { statsOf, type SurfaceHandle, type SurfaceProps } from '../surface'
import { Panes, useViewModes } from '../views'
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

/** the parts of a document that decide its styling: the head plus any <style>/<link> in the body */
function styleKey(envelope: HtmlEnvelope): string {
  const inBody = envelope.body.match(/<style\b[\s\S]*?<\/style>|<link\b[^>]*>/gi) ?? []
  return `${envelope.prefix}\n${inBody.join('\n')}`
}

/**
 * HTML visual editor with source and side-by-side views. Only the inside of
 * <body> is edited; the head and the body tag are kept verbatim, and the
 * document's stylesheets are applied to the canvas so what you edit is what
 * the browser shows.
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
  const [find, setFind] = useState<{ replace: boolean } | null>(null)
  const [outlineOpen, setOutlineOpen] = useOutlinePref()
  const [rawEdit, setRawEdit] = useState<RawHtmlEditDetail | null>(null)

  setImageBaseDir(path ? dirOf(path) : null)

  const extensions = useMemo(() => buildHtmlExtensions(), [])

  const bodyAttrsKey = JSON.stringify(envelope.bodyAttrs)
  const canvasAttributes = useMemo(() => {
    const { class: bodyClass, style, ...rest } = JSON.parse(bodyAttrsKey) as Record<string, string>
    const keep = Object.fromEntries(Object.entries(rest).filter(([name]) => !/^on/i.test(name)))
    return {
      ...keep,
      class: [CANVAS, bodyClass].filter(Boolean).join(' '),
      ...(style ? { style } : {}),
      spellcheck: 'false',
    }
  }, [bodyAttrsKey])

  const editorUpdateRef = useRef<() => void>(() => {})
  const editor = useEditor({
    extensions,
    content: '',
    autofocus: true,
    editorProps: { attributes: canvasAttributes },
    onUpdate: ({ editor: updated }) => {
      onDirtyRef.current()
      onStatsRef.current(statsOf(updated.getText()))
      editorUpdateRef.current()
    },
  })

  useEffect(() => {
    editor?.setOptions({ editorProps: { attributes: canvasAttributes } })
  }, [editor, canvasAttributes])

  const load = useCallback(
    (raw: string, undoable: boolean) => {
      if (!editor) return
      const next = parseHtmlDocument(raw)
      setEnvelope(next)
      envelopeRef.current = next
      editor.chain().setMeta('addToHistory', undoable).setContent(next.body, { emitUpdate: false }).run()
      originalRef.current = { raw, doc: editor.state.doc }
      onStatsRef.current(statsOf(editor.getText()))
    },
    [editor],
  )

  const serialize = useCallback((): string => {
    if (!editor) return startText
    const original = originalRef.current
    if (original && editor.state.doc.eq(original.doc)) return original.raw
    return serializeHtmlDocument(envelopeRef.current, cleanSerializedHtml(editor.getHTML(), BARE_ATTR))
  }, [editor, startText])

  const views = useViewModes({ prefKey: 'html', serialize, load, onDirty, onStats })
  editorUpdateRef.current = views.onEditorUpdate

  useEffect(() => {
    if (!editor) return
    // an untitled document starts from the template, which is not an edit
    load(startText, false)
    views.reseed()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  // the document's stylesheets follow the head (and any inline <style> in the body)
  const stylesKey = styleKey(envelope)
  const [documentCss, setDocumentCss] = useState('')
  useEffect(() => {
    let alive = true
    void buildDocumentCss(stylesKey, path).then((css) => {
      if (alive) setDocumentCss(css)
    })
    return () => {
      alive = false
    }
  }, [stylesKey, path])

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
      getContent: views.getContent,
      markSaved(content) {
        if (views.mode === 'source' || !editor) return
        views.settle()
        originalRef.current = { raw: content, doc: editor.state.doc }
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
        // the page is the document itself; its relative links resolve against its folder
        return { html: views.getContent(), baseDir: path ? dirOf(path) : null }
      },
      async richCopy() {
        views.settle()
        const html = editor ? cleanSerializedHtml(editor.getHTML(), BARE_ATTR) : ''
        return { html, text: editor?.getText({ blockSeparator: '\n\n' }) ?? '' }
      },
    }),
    [views, editor, outlineOpen, setOutlineOpen, path],
  )

  const showOutline = outlineOpen && views.mode !== 'source' && editor

  return (
    <div className="surface">
      <style>{documentCss}</style>
      <Toolbar
        editor={editor}
        kind="html"
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
          prefKey="html"
          language="html"
          wrap={wrap}
          visualScrollRef={scrollRef}
          visualClassName="html-scroll"
        >
          <div className="html-page" style={{ zoom: zoom / 100 }}>
            <EditorContent editor={editor} />
          </div>
        </Panes>
      </div>
      {views.mode !== 'source' && <TableMenu editor={editor} scrollRef={scrollRef} zoom={zoom} />}
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
