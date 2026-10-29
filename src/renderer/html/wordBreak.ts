import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'

/**
 * Korean word wrapping: `word-break: keep-all` keeps a Korean word whole at a
 * line break instead of splitting it between syllables. It can be set on the
 * whole document (the <body> tag), on paragraphs and on table cells.
 */

export const KEEP_ALL = 'keep-all'

/** blocks the paragraph option applies to */
const TEXT_BLOCKS = ['paragraph', 'heading', 'htmlTextContainer']
const CELLS = ['tableCell', 'tableHeader']

/** node types whose `word-break` is held in their own attribute rather than in the preserved style */
export const WORD_BREAK_TYPES = [...TEXT_BLOCKS, ...CELLS]

/** the `word-break` value an inline style declares, or null */
export function styleWordBreak(style: string | null | undefined): string | null {
  for (const decl of (style ?? '').split(';')) {
    const colon = decl.indexOf(':')
    if (colon < 0) continue
    if (decl.slice(0, colon).trim().toLowerCase() === 'word-break') return decl.slice(colon + 1).trim() || null
  }
  return null
}

/** the style with its `word-break` declaration set to keep-all, or removed */
export function withKeepAll(style: string | null | undefined, on: boolean): string {
  const decls = (style ?? '')
    .split(';')
    .map((decl) => decl.trim())
    .filter((decl) => decl && decl.slice(0, decl.indexOf(':')).trim().toLowerCase() !== 'word-break')
  if (on) decls.push(`word-break: ${KEEP_ALL}`)
  return decls.join('; ')
}

/** carries `word-break` on paragraphs, headings, text containers and cells; it follows Enter like text-align */
export const WordBreak = Extension.create({
  name: 'wordBreak',

  addGlobalAttributes() {
    return [
      {
        types: WORD_BREAK_TYPES,
        attributes: {
          wordBreak: {
            default: null,
            parseHTML: (element: HTMLElement) => styleWordBreak(element.getAttribute('style')),
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.wordBreak ? { style: `word-break: ${String(attrs.wordBreak)}` } : {},
          },
        },
      },
    ]
  },
})

type Target = { pos: number; keepAll: boolean }

function textBlocksIn(state: EditorState): Target[] {
  const out: Target[] = []
  const seen = new Set<number>()
  for (const range of state.selection.ranges) {
    state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node, pos) => {
      if (!TEXT_BLOCKS.includes(node.type.name)) return true
      if (!seen.has(pos)) out.push({ pos, keepAll: node.attrs.wordBreak === KEEP_ALL })
      seen.add(pos)
      return false
    })
  }
  return out
}

function cellsIn(state: EditorState): Target[] {
  const { selection } = state
  const out: Target[] = []
  if (selection instanceof CellSelection) {
    selection.forEachCell((node, pos) => out.push({ pos, keepAll: node.attrs.wordBreak === KEEP_ALL }))
    return out
  }
  const { $from } = selection
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth)
    if (CELLS.includes(node.type.name)) {
      out.push({ pos: $from.before(depth), keepAll: node.attrs.wordBreak === KEEP_ALL })
      break
    }
  }
  return out
}

/** keep-all state of the selected paragraphs or cells: null when there are none */
function stateOf(targets: Target[]): boolean | null {
  return targets.length ? targets.every((target) => target.keepAll) : null
}

export const paragraphKeepAll = (state: EditorState) => stateOf(textBlocksIn(state))
export const cellKeepAll = (state: EditorState) => stateOf(cellsIn(state))

function apply(editor: Editor, targets: Target[], on: boolean): boolean {
  if (!targets.length) return false
  const tr: Transaction = editor.state.tr
  for (const { pos, keepAll } of targets) {
    if (on) tr.setNodeAttribute(pos, 'wordBreak', KEEP_ALL)
    else if (keepAll) tr.setNodeAttribute(pos, 'wordBreak', null)
  }
  editor.view.dispatch(tr)
  editor.commands.focus()
  return true
}

export const setParagraphKeepAll = (editor: Editor, on: boolean) => apply(editor, textBlocksIn(editor.state), on)
export const setCellKeepAll = (editor: Editor, on: boolean) => apply(editor, cellsIn(editor.state), on)

const BODY_TAG = /<body\b[^>]*>$/i
const STYLE_ATTR = /(\sstyle\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i

/**
 * The document prefix (text up to and including <body …>) with keep-all set on
 * or removed from the body tag's style; null when the document has no <body>
 * tag. Only the style attribute changes; the rest of the tag stays as written.
 */
export function setBodyKeepAll(prefix: string, on: boolean): { prefix: string; style: string } | null {
  const tag = BODY_TAG.exec(prefix)?.[0]
  if (!tag) return null
  const match = STYLE_ATTR.exec(tag)
  const style = withKeepAll(match ? (match[2] ?? match[3] ?? match[4]) : '', on)
  let next: string
  if (match) {
    const quote = match[3] !== undefined ? "'" : '"'
    const value = quote === '"' ? style.replace(/"/g, '&quot;') : style
    const replacement = style ? `${match[1]}${quote}${value}${quote}` : ''
    next = tag.slice(0, match.index) + replacement + tag.slice(match.index + match[0].length)
  } else {
    next = style ? tag.replace(/\s*(\/?>)$/, ` style="${style}"$1`) : tag
  }
  return { prefix: prefix.slice(0, prefix.length - tag.length) + next, style }
}
