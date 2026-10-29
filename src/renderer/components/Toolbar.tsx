import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { t } from '../i18n/locale'
import type { StringKey } from '../i18n/locale'
import { Dropdown } from './dropdown'
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
  sourceMode: boolean
  onToggleSource: () => void
  onSave: () => void
  onInsertImage: () => void
}

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

function LinkButton({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  const [href, setHref] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLSpanElement>(null)

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
    if (value) chain.setLink({ href: value }).run()
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
          setHref(String(editor.getAttributes('link').href ?? ''))
          setOpen((value) => !value)
        }}
      >
        <IconLink size={18} />
      </Btn>
      {open && (
        <span className="tb-pop">
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
export function Toolbar({ editor, kind, sourceMode, onToggleSource, onSave, onInsertImage }: Props) {
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
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
      }
    },
  })

  const off = sourceMode || !editor || !state
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
      {editor && <LinkButton editor={editor} disabled={off} />}
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
      <button
        type="button"
        className={`tb-mode${sourceMode ? ' is-active' : ''}`}
        title={t('toggleSource')}
        onClick={onToggleSource}
      >
        <IconSourceCode size={16} />
        <span>{sourceMode ? t('viewVisual') : t('viewSource')}</span>
      </button>
    </div>
  )
}
