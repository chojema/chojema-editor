import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { useEditorState } from '@tiptap/react'
import { t } from '../i18n/locale'

interface Heading {
  level: number
  text: string
  pos: number
}

function collectHeadings(editor: Editor): Heading[] {
  const out: Heading[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      out.push({ level: Number(node.attrs.level) || 1, text: node.textContent.trim(), pos })
      return false
    }
    return true
  })
  return out
}

/** list of the document's headings; a click moves the caret there and scrolls it to the top */
export function OutlinePane({ editor }: { editor: Editor }) {
  const headings = useEditorState({ editor, selector: ({ editor: e }) => collectHeadings(e) }) ?? []
  const minLevel = headings.reduce((min, h) => Math.min(min, h.level), 6)

  const jump = (pos: number) => {
    const { state, view } = editor
    view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(pos + 1))))
    const dom = view.nodeDOM(pos)
    if (dom instanceof HTMLElement) dom.scrollIntoView({ block: 'start', behavior: 'smooth' })
    view.focus()
  }

  return (
    <nav className="outline-pane" aria-label={t('outline')}>
      <div className="outline-title">{t('outline')}</div>
      {headings.length === 0 ? (
        <div className="outline-empty">{t('outlineEmpty')}</div>
      ) : (
        <ul>
          {headings.map((h) => (
            <li key={h.pos}>
              <button
                type="button"
                className={`outline-item outline-l${h.level}`}
                style={{ paddingLeft: 10 + (h.level - minLevel) * 14 }}
                onClick={() => jump(h.pos)}
                title={h.text}
              >
                {h.text || '—'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  )
}
