import { Extension, Mark, mergeAttributes, Node } from '@tiptap/core'
import { WORD_BREAK_TYPES } from './wordBreak'

/**
 * Attribute preservation for the HTML editor. TipTap only keeps the attributes
 * its extensions declare, so without this layer an open→save cycle would strip
 * every class, id, inline style and data-* attribute from the document. The
 * helpers below keep whatever the stock extensions do not own, verbatim.
 */

export type AttrMap = Record<string, string>

/** CSS properties another extension already renders (TextAlign on blocks) */
const OWNED_STYLE_PROPS = new Set(['text-align'])

/** `word-break` on the node types the WordBreak extension covers */
const WORD_BREAK_PROPS = new Set(['word-break'])

function stripOwnedStyle(style: string, ownedStyle?: ReadonlySet<string>): string {
  return style
    .split(';')
    .map((decl) => decl.trim())
    .filter((decl) => {
      if (!decl) return false
      const prop = decl.slice(0, decl.indexOf(':')).trim().toLowerCase()
      return !OWNED_STYLE_PROPS.has(prop) && !ownedStyle?.has(prop)
    })
    .join('; ')
}

export function collectAttrs(
  element: HTMLElement,
  exclude: ReadonlySet<string>,
  ownedStyle?: ReadonlySet<string>,
): AttrMap | null {
  const out: AttrMap = {}
  for (const attr of Array.from(element.attributes)) {
    const name = attr.name.toLowerCase()
    if (exclude.has(name)) continue
    if (name === 'style') {
      const style = stripOwnedStyle(attr.value, ownedStyle)
      if (style) out.style = style
      continue
    }
    out[attr.name] = attr.value
  }
  return Object.keys(out).length > 0 ? out : null
}

function renderAttrs(value: unknown): AttrMap {
  return value && typeof value === 'object' ? (value as AttrMap) : {}
}

/** attributes each stock node or mark parses itself; everything else is preserved */
const OWNED: Record<string, string[]> = {
  paragraph: [],
  heading: [],
  blockquote: [],
  bulletList: [],
  orderedList: ['start', 'type'],
  listItem: [],
  taskList: ['data-type'],
  taskItem: ['data-type', 'data-checked'],
  codeBlock: [],
  horizontalRule: [],
  table: [],
  tableRow: [],
  tableCell: ['colspan', 'rowspan', 'colwidth'],
  tableHeader: ['colspan', 'rowspan', 'colwidth'],
  image: ['src', 'alt', 'title', 'width', 'height'],
  link: ['href', 'target', 'rel'],
}

/** keeps unknown attributes on every stock node and mark listed in OWNED */
export const PreserveAttributes = Extension.create({
  name: 'preserveAttributes',

  addGlobalAttributes() {
    return Object.entries(OWNED).map(([type, owned]) => {
      const exclude = new Set(owned)
      const ownedStyle = WORD_BREAK_TYPES.includes(type) ? WORD_BREAK_PROPS : undefined
      return {
        types: [type],
        attributes: {
          htmlAttrs: {
            default: null,
            // a new paragraph from Enter must not inherit the old one's id
            keepOnSplit: false,
            parseHTML: (element: HTMLElement) => collectAttrs(element, exclude, ownedStyle),
            renderHTML: (attrs: Record<string, unknown>) => renderAttrs(attrs.htmlAttrs),
          },
        },
      }
    })
  },
})

/** marks cells and list items whose text sat directly inside them, for {@link unwrapBareBlocks} */
export const BARE_ATTR = 'data-chojema-bare'

/**
 * TipTap requires a paragraph inside every table cell and list item, so
 * `<td>1</td>` would be saved as `<td><p>1</p></td>`. Cells and items that had
 * bare text on load (and new ones) are flagged here and unwrapped on save.
 */
export const BareTextBlocks = Extension.create({
  name: 'bareTextBlocks',

  addGlobalAttributes() {
    return [
      {
        types: ['tableCell', 'tableHeader', 'listItem'],
        attributes: {
          bare: {
            default: true,
            parseHTML: (element: HTMLElement) => !hasBlockChildren(element),
            renderHTML: (attrs: Record<string, unknown>) => (attrs.bare ? { [BARE_ATTR]: '' } : {}),
          },
        },
      },
    ]
  },
})

const CONTAINER_TAGS = [
  'div',
  'section',
  'article',
  'header',
  'footer',
  'main',
  'nav',
  'aside',
  'figure',
  'figcaption',
  'address',
  'center',
  'dl',
  'dt',
  'dd',
]

const BLOCK_CHILD = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'table',
  'hr', 'div', 'section', 'article', 'header', 'footer', 'main', 'nav', 'aside', 'figure',
  'figcaption', 'address', 'center', 'dl', 'dt', 'dd', 'form', 'fieldset', 'details',
  'iframe', 'video', 'audio', 'canvas', 'script', 'style', 'noscript', 'template', 'object',
  'embed', 'picture',
])

export function hasBlockChildren(element: HTMLElement): boolean {
  return Array.from(element.children).some((child) => BLOCK_CHILD.has(child.tagName.toLowerCase()))
}

const NO_EXCLUDE = new Set<string>()

function containerRule(tag: string, wantsBlocks: boolean) {
  return {
    tag,
    getAttrs: (element: HTMLElement) =>
      hasBlockChildren(element) === wantsBlocks
        ? { tag, htmlAttrs: collectAttrs(element, NO_EXCLUDE, wantsBlocks ? undefined : WORD_BREAK_PROPS) }
        : false,
  }
}

const containerAttrs = {
  tag: { default: 'div' },
  htmlAttrs: { default: null },
}

/** <div>/<section>/… that hold other blocks */
export const HtmlBlockContainer = Node.create({
  name: 'htmlBlockContainer',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes: () => containerAttrs,
  parseHTML: () => CONTAINER_TAGS.map((tag) => containerRule(tag, true)),
  renderHTML({ node }) {
    return [String(node.attrs.tag), renderAttrs(node.attrs.htmlAttrs), 0]
  },
})

/**
 * <div>/<figcaption>/… that hold only text. Kept apart from the block
 * container so `<div>text</div>` does not come back as `<div><p>text</p></div>`.
 */
export const HtmlTextContainer = Node.create({
  name: 'htmlTextContainer',
  group: 'block',
  content: 'inline*',
  defining: true,
  addAttributes: () => containerAttrs,
  parseHTML: () => CONTAINER_TAGS.map((tag) => containerRule(tag, false)),
  renderHTML({ node }) {
    return [String(node.attrs.tag), renderAttrs(node.attrs.htmlAttrs), 0]
  },
})

const INLINE_TAGS = [
  'abbr', 'kbd', 'small', 'cite', 'time', 'q', 'dfn', 'var', 'samp', 'ins', 'big', 'bdi',
  'bdo', 'data', 'label', 'font', 'span',
]

/**
 * Inline elements no stock mark understands. A span is taken only when it
 * carries something besides `style` (TextStyle already keeps styled spans),
 * and the rule does not consume, so the two marks can share one span.
 */
export const HtmlInline = Mark.create({
  name: 'htmlInline',
  excludes: '',
  priority: 40,
  addAttributes: () => ({
    tag: { default: 'span' },
    htmlAttrs: { default: null },
  }),
  parseHTML() {
    const styleOwned = new Set(['style'])
    return INLINE_TAGS.map((tag) => ({
      tag,
      consuming: false,
      getAttrs: (element: HTMLElement) => {
        const attrs = collectAttrs(element, tag === 'span' ? styleOwned : NO_EXCLUDE)
        if (tag === 'span' && !attrs) return false
        return { tag, htmlAttrs: attrs }
      },
    }))
  },
  renderHTML({ mark }) {
    return [String(mark.attrs.tag), mergeAttributes(renderAttrs(mark.attrs.htmlAttrs)), 0]
  },
})
