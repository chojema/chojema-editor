import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { searchPluginKey, type SearchRange } from '../editor/searchHighlight'
import { t } from '../i18n/locale'

/** a leaf inline node (image, hard break, atom) occupies one position; this keeps text offsets aligned */
const LEAF = '\uFFFC'

export function findRanges(doc: PmNode, query: string, matchCase: boolean): SearchRange[] {
  if (!query) return []
  const needle = matchCase ? query : query.toLowerCase()
  const ranges: SearchRange[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    let text = ''
    node.forEach((child) => {
      text += child.isText ? (child.text ?? '') : LEAF.repeat(child.nodeSize)
    })
    const hay = matchCase ? text : text.toLowerCase()
    for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + needle.length)) {
      ranges.push({ from: pos + 1 + at, to: pos + 1 + at + needle.length })
    }
    return false
  })
  return ranges
}

interface Props {
  editor: Editor
  onClose: () => void
}

/** find bar for the TipTap surfaces; CodeMirror views use their own search panel */
export function FindBar({ editor, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [ranges, setRanges] = useState<SearchRange[]>([])
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const paint = useCallback(
    (next: SearchRange[], index: number, scroll: boolean) => {
      const tr = editor.state.tr.setMeta(searchPluginKey, { ranges: next, activeIndex: index })
      tr.setMeta('addToHistory', false)
      const hit = next[index]
      if (scroll && hit) tr.setSelection(TextSelection.create(tr.doc, hit.from, hit.to)).scrollIntoView()
      editor.view.dispatch(tr)
    },
    [editor],
  )

  // recompute on query change and whenever the document changes underneath
  useEffect(() => {
    const run = () => {
      const next = findRanges(editor.state.doc, query, matchCase)
      setRanges(next)
      setActive((index) => (index < next.length ? index : 0))
      return next
    }
    const next = run()
    paint(next, 0, next.length > 0)
    const onUpdate = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (!transaction.docChanged) return
      const updated = run()
      paint(updated, 0, false)
    }
    editor.on('update', onUpdate)
    return () => {
      editor.off('update', onUpdate)
    }
  }, [editor, query, matchCase, paint])

  // clear the highlights when the bar closes
  useEffect(() => () => paint([], 0, false), [paint])

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const step = (delta: number) => {
    if (ranges.length === 0) return
    const index = (active + delta + ranges.length) % ranges.length
    setActive(index)
    paint(ranges, index, true)
  }

  return (
    <div className="find-bar" role="search">
      <input
        ref={inputRef}
        className="find-input"
        value={query}
        placeholder={t('findPlaceholder')}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            step(event.shiftKey ? -1 : 1)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
            editor.commands.focus()
          }
        }}
      />
      <span className="find-count">
        {query ? (ranges.length ? t('findCount', { i: active + 1, n: ranges.length }) : t('findNone')) : ''}
      </span>
      <label className="find-case" title={t('matchCase')}>
        <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} />
        Aa
      </label>
      <button type="button" className="find-btn" title={t('findPrev')} onClick={() => step(-1)}>
        ↑
      </button>
      <button type="button" className="find-btn" title={t('findNext')} onClick={() => step(1)}>
        ↓
      </button>
      <button
        type="button"
        className="find-btn"
        title={t('findClose')}
        onClick={() => {
          onClose()
          editor.commands.focus()
        }}
      >
        ✕
      </button>
    </div>
  )
}
