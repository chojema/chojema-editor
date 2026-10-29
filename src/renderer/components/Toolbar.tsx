import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { t } from '../i18n/locale'
import type { StringKey } from '../i18n/locale'
import { Dropdown } from './dropdown'
import { OPEN_LINK_EVENT } from '../editor/blockKeymap'
import { linkTargetAttrs, opensInNewWindow } from '../html/linkTarget'
import { cellKeepAll, paragraphKeepAll, setCellKeepAll, setParagraphKeepAll } from '../html/wordBreak'
import type { ViewMode } from '../views'
import {
  IconAlignCenter,
  IconAlignJustify,
  IconAlignLeft,
  IconAlignRight,
  IconBullets,
  IconClearFormat,
  IconFontColorA,
  IconHighlight,
  IconHr,
  IconInlineCode,
  IconLink,
  IconNumbered,
  IconOutlineView,
  IconPicture,
  IconQuoteMark,
  IconRedo,
  IconSave,
  IconSourceCode,
  IconSubscript,
  IconSuperscript,
  IconTable,
  IconTaskList,
  IconUndo,
  IconWordWrap,
} from './toolbar-icons'

export type ToolbarKind = 'markdown' | 'html'

type BlockStyle = 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'pre'

const BLOCK_LABELS: Record<BlockStyle, StringKey> = {
  p: 'styleParagraph',
  h1: 'styleH1',
  h2: 'styleH2',
  h3: 'styleH3',
  h4: 'styleH4',
  h5: 'styleH5',
  h6: 'styleH6',
  pre: 'styleCodeBlock',
}

const FONT_FAMILIES = [
  { value: '', label: () => t('fontDefault') },
  { value: "-apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif", label: () => '고딕 (Sans)' },
  { value: "'AppleMyungjo', 'Batang', serif", label: () => '명조 (Serif)' },
  { value: "'SF Mono', Menlo, Consolas, monospace", label: () => '고정폭 (Mono)' },
  { value: 'Georgia, serif', label: () => 'Georgia' },
  { value: 'Arial, Helvetica, sans-serif', label: () => 'Arial' },
]

const FONT_SIZES = ['', '12px', '14px', '16px', '18px', '20px', '24px', '28px', '32px', '40px']

interface Props {
  editor: Editor | null
  kind: ToolbarKind
  mode: ViewMode
  onMode: (mode: ViewMode) => void
  outlineOpen: boolean
  onToggleOutline: () => void
  onSave: () => void
  onInsertImage: () => void
  /** HTML: keep-all on the <body> tag; null when the document has no <body> tag */
  docKeepAll?: boolean | null
  onDocKeepAll?: (on: boolean) => void
}

const MODES: { mode: ViewMode; label: StringKey; tip: StringKey }[] = [
  { mode: 'visual', label: 'viewVisual', tip: 'viewVisualTip' },
  { mode: 'split', label: 'viewSplit', tip: 'viewSplitTip' },
  { mode: 'source', label: 'viewSource', tip: 'viewSourceTip' },
]

function Btn({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className={`tb-btn${active ? ' is-active' : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      // keep the editor selection: a mousedown on the button would blur it
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function Sep() {
  return <span className="tb-sep" aria-hidden />
}

/** left offset that keeps a popover anchored under its button inside the window */
function useKeepInWindow(open: boolean, popRef: RefObject<HTMLElement | null>, key?: unknown) {
  const [shift, setShift] = useState(0)
  useLayoutEffect(() => {
    if (!open || !popRef.current) return setShift(0)
    const overflow = popRef.current.getBoundingClientRect().right - shift - (window.innerWidth - 8)
    setShift(overflow > 0 ? overflow : 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key])
  return shift ? { left: -shift } : undefined
}

function LinkButton({ editor, disabled, html }: { editor: Editor; disabled: boolean; html: boolean }) {
  const [open, setOpen] = useState(false)
  const [href, setHref] = useState('')
  const [newWindow, setNewWindow] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const popRef = useRef<HTMLSpanElement>(null)
  const popStyle = useKeepInWindow(open, popRef, html)

  const loadLink = () => {
    const attrs = editor.getAttributes('link')
    setHref(String(attrs.href ?? ''))
    setNewWindow(opensInNewWindow(attrs.target))
  }

  // ⌘K in the editor asks for this popover
  useEffect(() => {
    const openFromShortcut = () => {
      if (disabled) return
      loadLink()
      setOpen(true)
    }
    window.addEventListener(OPEN_LINK_EVENT, openFromShortcut)
    return () => window.removeEventListener(OPEN_LINK_EVENT, openFromShortcut)
  }, [editor, disabled])

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    inputRef.current?.select()
    const close = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const apply = () => {
    const value = href.trim()
    const chain = editor.chain().focus().extendMarkRange('link')
    // Markdown has no link target; HTML carries the new-window choice as target/rel
    const targetAttrs = html ? linkTargetAttrs(editor.getAttributes('link'), newWindow) : {}
    if (value) chain.setLink({ href: value, ...targetAttrs }).run()
    else chain.unsetLink().run()
    setOpen(false)
  }

  return (
    <span className="tb-pop-anchor" ref={wrapRef}>
      <Btn
        label={t('link')}
        active={editor.isActive('link')}
        disabled={disabled}
        onClick={() => {
          loadLink()
          setOpen((value) => !value)
        }}
      >
        <IconLink size={18} />
      </Btn>
      {open && (
        <span className="tb-pop" ref={popRef} style={popStyle}>
          <input
            ref={inputRef}
            className="tb-input"
            value={href}
            placeholder={t('linkUrlPlaceholder')}
            onChange={(event) => setHref(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') apply()
              if (event.key === 'Escape') {
                setOpen(false)
                editor.commands.focus()
              }
            }}
          />
          {html && (
            <label className="tb-check">
              <input
                type="checkbox"
                checked={newWindow}
                onChange={(event) => setNewWindow(event.target.checked)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') apply()
                  if (event.key === 'Escape') {
                    setOpen(false)
                    editor.commands.focus()
                  }
                }}
              />
              {t('linkNewWindow')}
            </label>
          )}
          <button type="button" className="tb-text-btn" onClick={apply}>
            {t('linkApply')}
          </button>
          {editor.isActive('link') && (
            <button
              type="button"
              className="tb-text-btn"
              onClick={() => {
                editor.chain().focus().extendMarkRange('link').unsetLink().run()
                setOpen(false)
              }}
            >
              {t('unlink')}
            </button>
          )}
        </span>
      )}
    </span>
  )
}

/** word-unit line breaking for Korean: whole document, selected paragraphs, selected cells */
function WordBreakButton({
  editor,
  disabled,
  paragraph,
  cell,
  doc,
  onDoc,
}: {
  editor: Editor
  disabled: boolean
  paragraph: boolean | null
  cell: boolean | null
  doc: boolean | null
  onDoc: (on: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const popRef = useRef<HTMLSpanElement>(null)
  const popStyle = useKeepInWindow(open, popRef)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        editor.commands.focus()
      }
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [open, editor])

  const rows: { label: StringKey; checked: boolean | null; toggle: (on: boolean) => void }[] = [
    { label: 'keepWordsDocument', checked: doc, toggle: onDoc },
    { label: 'keepWordsParagraph', checked: paragraph, toggle: (on) => setParagraphKeepAll(editor, on) },
    { label: 'keepWordsCell', checked: cell, toggle: (on) => setCellKeepAll(editor, on) },
  ]

  return (
    <span className="tb-pop-anchor" ref={wrapRef}>
      <Btn
        label={t('keepWords')}
        active={Boolean(doc || paragraph || cell)}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <IconWordWrap size={18} />
      </Btn>
      {open && (
        <span className="tb-pop tb-pop-column" ref={popRef} style={popStyle} role="group" aria-label={t('keepWords')}>
          <span className="tb-pop-title">{t('keepWordsTitle')}</span>
          {rows.map((row) => (
            <label key={row.label} className={`tb-check${row.checked === null ? ' is-disabled' : ''}`}>
              <input
                type="checkbox"
                checked={row.checked === true}
                disabled={row.checked === null}
                onChange={(event) => row.toggle(event.target.checked)}
              />
              {t(row.label)}
            </label>
          ))}
        </span>
      )}
    </span>
  )
}

function ColorButton({
  label,
  icon,
  value,
  onPick,
  disabled,
}: {
  label: string
  icon: ReactNode
  value: string
  onPick: (color: string) => void
  disabled: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <span className="tb-color">
      <Btn label={label} disabled={disabled} onClick={() => inputRef.current?.click()}>
        {icon}
        <span className="tb-color-bar" style={{ background: value || 'transparent' }} />
      </Btn>
      <input
        ref={inputRef}
        type="color"
        tabIndex={-1}
        aria-hidden
        className="tb-color-input"
        value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'}
        onChange={(event) => onPick(event.target.value)}
      />
    </span>
  )
}

/** the formatting row above the Markdown and HTML visual editors */
export function Toolbar({
  editor,
  kind,
  mode,
  onMode,
  outlineOpen,
  onToggleOutline,
  onSave,
  onInsertImage,
  docKeepAll = null,
  onDocKeepAll = () => {},
}: Props) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return null
      const block: BlockStyle = e.isActive('codeBlock')
        ? 'pre'
        : ([1, 2, 3, 4, 5, 6].map((level) => (e.isActive('heading', { level }) ? `h${level}` : null)).find(Boolean) as BlockStyle | undefined) ?? 'p'
      const textStyle = e.getAttributes('textStyle')
      return {
        block,
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        underline: e.isActive('underline'),
        strike: e.isActive('strike'),
        code: e.isActive('code'),
        highlight: e.isActive('highlight'),
        bullet: e.isActive('bulletList'),
        ordered: e.isActive('orderedList'),
        task: e.isActive('taskList'),
        quote: e.isActive('blockquote'),
        sub: e.isActive('subscript'),
        sup: e.isActive('superscript'),
        align: (['left', 'center', 'right', 'justify'] as const).find((a) =>
          e.isActive({ textAlign: a }),
        ),
        color: String(textStyle.color ?? ''),
        background: String(textStyle.backgroundColor ?? ''),
        fontFamily: String(textStyle.fontFamily ?? ''),
        fontSize: String(textStyle.fontSize ?? ''),
        paragraphKeepAll: kind === 'html' ? paragraphKeepAll(e.state) : null,
        cellKeepAll: kind === 'html' ? cellKeepAll(e.state) : null,
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
      }
    },
  })

  const off = mode === 'source' || !editor || !state
  const html = kind === 'html'
  const chain = () => editor!.chain().focus()

  const setBlock = (style: BlockStyle) => {
    if (style === 'p') chain().setParagraph().run()
    else if (style === 'pre') chain().toggleCodeBlock().run()
    else chain().setHeading({ level: Number(style.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6 }).run()
  }

  const blockOptions = (Object.keys(BLOCK_LABELS) as BlockStyle[]).map((value) => ({
    value,
    label: t(BLOCK_LABELS[value]),
  }))

  return (
    <div className="toolbar" role="toolbar">
      <Btn label={t('save')} onClick={onSave}>
        <IconSave size={18} />
      </Btn>
      <Btn label={t('undo')} disabled={off || !state.canUndo} onClick={() => chain().undo().run()}>
        <IconUndo size={18} />
      </Btn>
      <Btn label={t('redo')} disabled={off || !state.canRedo} onClick={() => chain().redo().run()}>
        <IconRedo size={18} />
      </Btn>
      <Sep />
      <Dropdown
        className="tb-block-dd"
        value={state?.block ?? 'p'}
        options={blockOptions}
        onPick={setBlock}
        ariaLabel={t('paragraphStyle')}
        disabled={off}
      />
      {html && (
        <>
          <Dropdown
            className="tb-font-dd"
            value={state?.fontFamily ?? ''}
            options={FONT_FAMILIES.map((f) => ({ value: f.value, label: f.label() }))}
            onPick={(value) =>
              value ? chain().setFontFamily(value).run() : chain().unsetFontFamily().run()
            }
            ariaLabel={t('fontFamily')}
            disabled={off}
          />
          <Dropdown
            className="tb-size-dd"
            value={state?.fontSize ?? ''}
            options={FONT_SIZES.map((value) => ({ value, label: value || t('sizeDefault') }))}
            onPick={(value) =>
              value ? chain().setFontSize(value).run() : chain().unsetFontSize().run()
            }
            ariaLabel={t('fontSize')}
            disabled={off}
          />
        </>
      )}
      <Sep />
      <Btn label={t('bold')} active={state?.bold} disabled={off} onClick={() => chain().toggleBold().run()}>
        <span className="tb-glyph tb-b">B</span>
      </Btn>
      <Btn label={t('italic')} active={state?.italic} disabled={off} onClick={() => chain().toggleItalic().run()}>
        <span className="tb-glyph tb-i">I</span>
      </Btn>
      {html && (
        <Btn label={t('underline')} active={state?.underline} disabled={off} onClick={() => chain().toggleUnderline().run()}>
          <span className="tb-glyph tb-u">U</span>
        </Btn>
      )}
      <Btn label={t('strike')} active={state?.strike} disabled={off} onClick={() => chain().toggleStrike().run()}>
        <span className="tb-glyph tb-s">S</span>
      </Btn>
      <Btn label={t('inlineCode')} active={state?.code} disabled={off} onClick={() => chain().toggleCode().run()}>
        <IconInlineCode size={18} />
      </Btn>
      {html ? (
        <>
          <ColorButton
            label={t('textColor')}
            icon={<IconFontColorA size={18} />}
            value={state?.color ?? ''}
            disabled={off}
            onPick={(color) => chain().setColor(color).run()}
          />
          <ColorButton
            label={t('bgColor')}
            icon={<IconHighlight size={18} />}
            value={state?.background ?? ''}
            disabled={off}
            onPick={(color) => chain().setBackgroundColor(color).run()}
          />
          <Btn label={t('subscript')} active={state?.sub} disabled={off} onClick={() => chain().toggleSubscript().run()}>
            <IconSubscript size={18} />
          </Btn>
          <Btn label={t('superscript')} active={state?.sup} disabled={off} onClick={() => chain().toggleSuperscript().run()}>
            <IconSuperscript size={18} />
          </Btn>
        </>
      ) : (
        <Btn label={t('highlight')} active={state?.highlight} disabled={off} onClick={() => chain().toggleMark('highlight').run()}>
          <IconHighlight size={18} />
        </Btn>
      )}
      {editor && <LinkButton editor={editor} disabled={off} html={html} />}
      {html && (
        <Btn
          label={t('clearFormat')}
          disabled={off}
          onClick={() => chain().unsetAllMarks().unsetTextAlign().run()}
        >
          <IconClearFormat size={18} />
        </Btn>
      )}
      <Sep />
      {html && (
        <>
          <Btn label={t('alignLeft')} active={state?.align === 'left'} disabled={off} onClick={() => chain().setTextAlign('left').run()}>
            <IconAlignLeft size={18} />
          </Btn>
          <Btn label={t('alignCenter')} active={state?.align === 'center'} disabled={off} onClick={() => chain().setTextAlign('center').run()}>
            <IconAlignCenter size={18} />
          </Btn>
          <Btn label={t('alignRight')} active={state?.align === 'right'} disabled={off} onClick={() => chain().setTextAlign('right').run()}>
            <IconAlignRight size={18} />
          </Btn>
          <Btn label={t('alignJustify')} active={state?.align === 'justify'} disabled={off} onClick={() => chain().setTextAlign('justify').run()}>
            <IconAlignJustify size={18} />
          </Btn>
          {editor && (
            <WordBreakButton
              editor={editor}
              disabled={off}
              paragraph={state?.paragraphKeepAll ?? null}
              cell={state?.cellKeepAll ?? null}
              doc={docKeepAll}
              onDoc={onDocKeepAll}
            />
          )}
          <Sep />
        </>
      )}
      <Btn label={t('bulletList')} active={state?.bullet} disabled={off} onClick={() => chain().toggleBulletList().run()}>
        <IconBullets size={18} />
      </Btn>
      <Btn label={t('orderedList')} active={state?.ordered} disabled={off} onClick={() => chain().toggleOrderedList().run()}>
        <IconNumbered size={18} />
      </Btn>
      <Btn label={t('taskList')} active={state?.task} disabled={off} onClick={() => chain().toggleTaskList().run()}>
        <IconTaskList size={18} />
      </Btn>
      <Btn label={t('styleQuote')} active={state?.quote} disabled={off} onClick={() => chain().toggleBlockquote().run()}>
        <IconQuoteMark size={18} />
      </Btn>
      <Sep />
      <Btn
        label={t('insertTable')}
        disabled={off}
        onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
      >
        <IconTable size={18} />
      </Btn>
      <Btn label={t('insertImage')} disabled={off} onClick={onInsertImage}>
        <IconPicture size={18} />
      </Btn>
      <Btn label={t('insertHr')} disabled={off} onClick={() => chain().setHorizontalRule().run()}>
        <IconHr size={18} />
      </Btn>
      <span className="tb-spacer" />
      <Btn label={t('outlineTip')} active={outlineOpen} disabled={mode === 'source'} onClick={onToggleOutline}>
        <IconOutlineView size={18} />
      </Btn>
      <div className="tb-modes" role="group" aria-label={t('viewMode')}>
        {MODES.map((m) => (
          <button
            key={m.mode}
            type="button"
            className={`tb-mode${mode === m.mode ? ' is-active' : ''}`}
            title={t(m.tip)}
            aria-pressed={mode === m.mode}
            onClick={() => onMode(m.mode)}
          >
            {m.mode === 'source' && <IconSourceCode size={15} />}
            <span>{t(m.label)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
