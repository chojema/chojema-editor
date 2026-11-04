import { CodeBlock } from '@tiptap/extension-code-block'
import { findChildren } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { createLowlight } from 'lowlight'

/** Starts empty: the grammars arrive on first code block (see loadGrammars) */
export const lowlight = createLowlight()

let grammarsLoaded = false
let loading: Promise<void> | null = null
const onLoaded = new Set<() => void>()

/**
 * highlight.js grammars for the languages people usually put in documents.
 * Loaded on demand so documents without code blocks never pay for them.
 */
export function loadGrammars(): Promise<void> {
  loading ??= import('./lowlightGrammars').then(({ common }) => {
    lowlight.register(common)
    grammarsLoaded = true
    for (const notify of onLoaded) notify()
    onLoaded.clear()
  })
  return loading
}

type HastNode = { type: string; value?: string; children?: HastNode[]; properties?: { className?: string[] } }

function flatten(nodes: HastNode[], className: string[] = []): { text: string; classes: string[] }[] {
  return nodes.flatMap((node) => {
    const classes = [...className, ...(node.properties?.className ?? [])]
    if (node.children) return flatten(node.children, classes)
    return { text: node.value ?? '', classes }
  })
}

function buildDecorations(doc: ProseMirrorNode, name: string, defaultLanguage: string | null): DecorationSet {
  if (!grammarsLoaded) return DecorationSet.empty
  const decorations: Decoration[] = []
  for (const block of findChildren(doc, (node) => node.type.name === name)) {
    let from = block.pos + 1
    const language = (block.node.attrs.language as string | null) || defaultLanguage
    const text = block.node.textContent
    const tree =
      language && lowlight.registered(language) ? lowlight.highlight(language, text) : lowlight.highlightAuto(text)
    for (const piece of flatten(tree.children as HastNode[])) {
      const to = from + piece.text.length
      if (piece.classes.length) decorations.push(Decoration.inline(from, to, { class: piece.classes.join(' ') }))
      from = to
    }
  }
  return DecorationSet.create(doc, decorations)
}

function hasBlock(doc: ProseMirrorNode, name: string): boolean {
  let found = false
  doc.descendants((node) => {
    if (found) return false
    if (node.type.name === name) found = true
    return !found
  })
  return found
}

/**
 * Same decoration rules as @tiptap/extension-code-block-lowlight, plus a
 * refresh once the grammars have loaded: until then code renders unhighlighted.
 */
function lazyLowlightPlugin(name: string, defaultLanguage: string | null): Plugin<DecorationSet> {
  // one key per instance, as upstream: an editor may carry several code block types
  const lazyLowlightKey = new PluginKey<DecorationSet>('lazyLowlight')
  return new Plugin<DecorationSet>({
    key: lazyLowlightKey,
    state: {
      init: (_, { doc }) => buildDecorations(doc, name, defaultLanguage),
      apply: (tr, set, oldState, newState) => {
        if (tr.getMeta(lazyLowlightKey)) return buildDecorations(tr.doc, name, defaultLanguage)
        if (!tr.docChanged) return set.map(tr.mapping, tr.doc)
        const oldNodeName = oldState.selection.$head.parent.type.name
        const newNodeName = newState.selection.$head.parent.type.name
        const oldNodes = findChildren(oldState.doc, (node) => node.type.name === name)
        const newNodes = findChildren(newState.doc, (node) => node.type.name === name)
        const touched =
          [oldNodeName, newNodeName].includes(name) ||
          newNodes.length !== oldNodes.length ||
          tr.steps.some((step) => {
            const { from, to } = step as unknown as { from?: number; to?: number }
            return (
              from !== undefined &&
              to !== undefined &&
              oldNodes.some((node) => node.pos >= from && node.pos + node.node.nodeSize <= to)
            )
          })
        return touched ? buildDecorations(tr.doc, name, defaultLanguage) : set.map(tr.mapping, tr.doc)
      },
    },
    props: {
      decorations: (state) => lazyLowlightKey.getState(state),
    },
    view: (view) => {
      let destroyed = false
      const refresh = () => {
        if (!destroyed) view.dispatch(view.state.tr.setMeta(lazyLowlightKey, true))
      }
      const ensure = (current: EditorView) => {
        if (grammarsLoaded || !hasBlock(current.state.doc, name)) return
        onLoaded.add(refresh)
        void loadGrammars().catch(() => onLoaded.delete(refresh))
      }
      ensure(view)
      return {
        update: (current, prev) => {
          if (current.state.doc !== prev.doc) ensure(current)
        },
        destroy: () => {
          destroyed = true
          onLoaded.delete(refresh)
        },
      }
    },
  })
}

/** Code block with syntax colouring; highlight.js grammars load on first use */
export const CodeBlockLowlight = CodeBlock.extend({
  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), lazyLowlightPlugin(this.name, this.options.defaultLanguage ?? null)]
  },
})
