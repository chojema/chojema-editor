import { InputRule, mergeAttributes, Node } from '@tiptap/core'
import { loadKatex, loadedKatex } from './katexLoader'

/*
 * Block and inline math nodes with the same schema, HTML, Markdown and input
 * rules as @tiptap/extension-mathematics (MIT). That package imports KaTeX
 * statically; these nodes render through a lazily loaded KaTeX instead, so
 * the ~250 KB library stays out of the startup bundle.
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    blockMath: {
      insertBlockMath: (options: { latex: string; pos?: number }) => ReturnType
      deleteBlockMath: (options?: { pos?: number }) => ReturnType
      updateBlockMath: (options?: { latex?: string; pos?: number }) => ReturnType
    }
    inlineMath: {
      insertInlineMath: (options: { latex: string; pos?: number }) => ReturnType
      deleteInlineMath: (options?: { pos?: number }) => ReturnType
      updateInlineMath: (options?: { latex?: string; pos?: number }) => ReturnType
    }
  }
}

/**
 * Draw `latex` into `target`; on a parse error show the source with the error
 * class. Until KaTeX has loaded the source shows as plain text.
 */
function renderInto(latex: string, target: HTMLElement, wrapper: HTMLElement, errorClass: string): void {
  const draw = (katex: NonNullable<ReturnType<typeof loadedKatex>>) => {
    try {
      katex.render(latex, target)
      wrapper.classList.remove(errorClass)
    } catch {
      wrapper.textContent = latex
      wrapper.classList.add(errorClass)
    }
  }
  const katex = loadedKatex()
  if (katex) {
    draw(katex)
    return
  }
  target.textContent = latex
  loadKatex().then(draw, () => wrapper.classList.add(errorClass))
}

const latexAttribute = {
  latex: {
    default: '',
    parseHTML: (element: HTMLElement) => element.getAttribute('data-latex'),
    renderHTML: (attributes: Record<string, unknown>) => ({ 'data-latex': attributes.latex }),
  },
}

export const BlockMath = Node.create({
  name: 'blockMath',
  group: 'block',
  atom: true,

  addAttributes: () => latexAttribute,

  addCommands() {
    return {
      insertBlockMath:
        ({ latex, pos }) =>
        ({ commands, editor }) => {
          if (!latex) return false
          return commands.insertContentAt(pos ?? editor.state.selection.from, { type: this.name, attrs: { latex } })
        },
      deleteBlockMath:
        (options) =>
        ({ editor, tr }) => {
          const pos = options?.pos ?? editor.state.selection.$from.pos
          const node = editor.state.doc.nodeAt(pos)
          if (!node || node.type.name !== this.name) return false
          tr.delete(pos, pos + node.nodeSize)
          return true
        },
      updateBlockMath:
        (options) =>
        ({ editor, tr }) => {
          const pos = options?.pos ?? editor.state.selection.$from.pos
          const node = editor.state.doc.nodeAt(pos)
          if (!node || node.type.name !== this.name) return false
          tr.setNodeMarkup(pos, this.type, { ...node.attrs, latex: options?.latex ?? node.attrs.latex })
          return true
        },
    }
  },

  parseHTML: () => [{ tag: 'div[data-type="block-math"]' }],

  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'block-math' })],

  parseMarkdown: (token) => ({ type: 'blockMath', attrs: { latex: token.latex } }),

  renderMarkdown: (node) => ['$$', String(node.attrs?.latex || ''), '$$'].join('\n'),

  markdownTokenizer: {
    name: 'blockMath',
    level: 'block',
    start: (src: string) => src.indexOf('$$'),
    tokenize: (src: string) => {
      const match = src.match(/^\$\$([^$]+)\$\$/)
      if (!match) return undefined
      return { type: 'blockMath', raw: match[0], latex: match[1].trim() }
    },
  },

  addInputRules() {
    return [
      new InputRule({
        find: /^\$\$\$([^$]+)\$\$\$$/,
        handler: ({ state, range, match }) => {
          const { tr } = state
          const $from = state.doc.resolve(range.from)
          const node = this.type.create({ latex: match[1] })
          const replacement =
            $from.depth > 0 &&
            $from.parent.isTextblock &&
            range.from === $from.start() &&
            range.to === $from.end() &&
            $from.node(-1).canReplaceWith($from.index(-1), $from.indexAfter(-1), this.type)
              ? { from: $from.before(), to: $from.after() }
              : range
          tr.replaceWith(replacement.from, replacement.to, node)
        },
      }),
    ]
  },

  addNodeView() {
    return ({ node }) => {
      const wrapper = document.createElement('div')
      const inner = document.createElement('div')
      wrapper.className = 'tiptap-mathematics-render'
      if (this.editor.isEditable) wrapper.classList.add('tiptap-mathematics-render--editable')
      inner.className = 'block-math-inner'
      wrapper.dataset.type = 'block-math'
      wrapper.setAttribute('data-latex', node.attrs.latex)
      wrapper.appendChild(inner)
      renderInto(node.attrs.latex, inner, wrapper, 'block-math-error')
      return { dom: wrapper }
    }
  },
})

export const InlineMath = Node.create({
  name: 'inlineMath',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes: () => latexAttribute,

  addCommands() {
    return {
      insertInlineMath:
        ({ latex, pos }) =>
        ({ editor, tr }) => {
          if (!latex) return false
          const from = pos ?? editor.state.selection.from
          tr.replaceWith(from, from, this.type.create({ latex }))
          return true
        },
      deleteInlineMath:
        (options) =>
        ({ editor, tr }) => {
          const pos = options?.pos ?? editor.state.selection.$from.pos
          const node = editor.state.doc.nodeAt(pos)
          if (!node || node.type.name !== this.name) return false
          tr.delete(pos, pos + node.nodeSize)
          return true
        },
      updateInlineMath:
        (options) =>
        ({ editor, tr }) => {
          const pos = options?.pos ?? editor.state.selection.$from.pos
          const node = editor.state.doc.nodeAt(pos)
          if (!node || node.type.name !== this.name) return false
          tr.setNodeMarkup(pos, this.type, { ...node.attrs, latex: options?.latex })
          return true
        },
    }
  },

  parseHTML: () => [{ tag: 'span[data-type="inline-math"]' }],

  renderHTML: ({ HTMLAttributes }) => ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'inline-math' })],

  parseMarkdown: (token) => ({ type: 'inlineMath', attrs: { latex: token.latex } }),

  renderMarkdown: (node) => `$${String(node.attrs?.latex || '')}$`,

  markdownTokenizer: {
    name: 'inlineMath',
    level: 'inline',
    start: (src: string) => src.indexOf('$'),
    tokenize: (src: string) => {
      const match = src.match(/^\$([^$]+)\$(?!\$)/)
      if (!match) return undefined
      return { type: 'inlineMath', raw: match[0], latex: match[1].trim() }
    },
  },

  addInputRules() {
    return [
      new InputRule({
        find: /(?<!\$)(\$\$([^$\n]+?)\$\$)(?!\$)/,
        handler: ({ state, range, match }) => {
          state.tr.replaceWith(range.from, range.to, this.type.create({ latex: match[2] }))
        },
      }),
    ]
  },

  addNodeView() {
    return ({ node }) => {
      const wrapper = document.createElement('span')
      wrapper.className = 'tiptap-mathematics-render'
      if (this.editor.isEditable) wrapper.classList.add('tiptap-mathematics-render--editable')
      wrapper.dataset.type = 'inline-math'
      wrapper.setAttribute('data-latex', node.attrs.latex)
      renderInto(node.attrs.latex, wrapper, wrapper, 'inline-math-error')
      return { dom: wrapper }
    }
  },
})
