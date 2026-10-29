import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { searchPluginKey, type SearchRange } from '../editor/searchHighlight'
import { t } from '../i18n/locale'

/** a leaf inline node (image, hard break, atom) occupies one position; this keeps text offsets aligned */
const LEAF = '￼'

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

/** replace every range in one undoable step; later ranges first so earlier positions stay valid */
export function replaceRanges(editor: Editor, ranges: SearchRange[], replacement: string): void {
  if (ranges.length === 0) return
  const tr = editor.state.tr
  for (const range of [...ranges].reverse()) {
    if (replacement) tr.insertText(replacement, range.from, range.to)
    else tr.delete(range.from, range.to)
  }
  editor.view.dispatch(tr)
}

interface Props {
  editor: Editor
  /** open with the replace row showing */
  withReplace: boolean
  onClose: () => void
}

/** find & replace for the TipTap surfaces; CodeMirror panes use their own search panel */
export function FindBar({ editor, withReplace, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [showReplace, setShowReplace] = useState(withReplace)
  const [matchCase, setMatchCase] = useState(false)
  const [ranges, setRanges] = useState<SearchRange[]>([])
  const [active, setActive] = useState(0)
  const activeRef = useRef(0)
  activeRef.current = active
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (withReplace) setShowReplace(true)
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [withReplace])

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
    const run = (keep: number) => {
      const next = findRanges(editor.state.doc, query, matchCase)
      const index = next.length === 0 ? 0 : Math.min(keep, next.length - 1)
      setRanges(next)
      setActive(index)
      return { next, index }
    }
    const first = run(0)
    paint(first.next, first.index, first.next.length > 0)
    const onUpdate = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (!transaction.docChanged) return
      // after a replace the next hit slides into the same index
      const updated = run(activeRef.current)
      paint(updated.next, updated.index, false)
    }
    editor.on('update', onUpdate)
    return () => {
      editor.off('update', onUpdate)
    }
  }, [editor, query, matchCase, paint])

  // clear the highlights when the bar closes
  useEffect(() => () => paint([], 0, false), [paint])

  const step = (delta: number) => {
    if (ranges.length === 0) return
    const index = (active + delta + ranges.length) % ranges.length
    setActive(index)
    paint(ranges, index, true)
  }

  const replaceOne = () => {
    const hit = ranges[active]
    if (hit) replaceRanges(editor, [hit], replacement)
  }

  const close = () => {
    onClose()
    editor.commands.focus()
  }

  return (
    <div className="find-bar" role="search">
      <div className="find-row">
        <button
          type="button"
          className="find-btn find-toggle"
          title={t('replace')}
          aria-expanded={showReplace}
          onClick={() => setShowReplace((v) => !v)}
        >
          {showReplace ? '▾' : '▸'}
        </button>
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
              close()
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
        <button type="button" className="find-btn" title={t('findClose')} onClick={close}>
          ✕
        </button>
      </div>
      {showReplace && (
        <div className="find-row">
          <span className="find-toggle-space" />
          <input
            className="find-input"
            value={replacement}
            placeholder={t('replacePlaceholder')}
            onChange={(event) => setReplacement(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                replaceOne()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                close()
              }
            }}
          />
          <button type="button" className="find-text-btn" disabled={!ranges.length} onClick={replaceOne}>
            {t('replaceOne')}
          </button>
          <button
            type="button"
            className="find-text-btn"
            disabled={!ranges.length}
            onClick={() => replaceRanges(editor, ranges, replacement)}
          >
            {t('replaceAll')}
          </button>
        </div>
      )}
    </div>
  )
}
