import { Node } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'
import type { NodeView } from '@tiptap/pm/view'
import { t } from '../i18n/locale'
import { resolveImageSrc } from '../editor/localImage'

/**
 * Elements the visual editor cannot edit (scripts, embeds, forms, SVG, …)
 * survive as opaque atoms holding their original markup. The editor shows a
 * preview where that is safe and a labelled box otherwise; a double-click
 * asks the surface to open the code editor for that one element.
 */

export const RAW_HTML_EDIT_EVENT = 'chojema-raw-html-edit'

export interface RawHtmlEditDetail {
  pos: number
  html: string
}

const RAW_TAGS = [
  'script', 'style', 'noscript', 'template', 'iframe', 'video', 'audio', 'svg', 'canvas',
  'form', 'object', 'embed', 'picture', 'math', 'details', 'select', 'input', 'button',
  'textarea', 'fieldset', 'map', 'meter', 'progress', 'output',
]

/** markup the preview may render: no scripts, no handlers, no frames that run code */
const PREVIEWABLE = new Set(['svg', 'video', 'audio', 'picture', 'math', 'canvas', 'details', 'meter', 'progress', 'select', 'input', 'button', 'textarea'])

/** tags that read as part of a line of text rather than a block of their own */
const INLINE_CONTEXT_PARENTS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'a', 'strong', 'em', 'b', 'i', 'u', 's',
  'label', 'small', 'mark', 'code', 'sub', 'sup', 'font', 'abbr', 'cite', 'q',
])

function sitsInText(element: HTMLElement): boolean {
  const parent = element.parentElement
  if (parent && INLINE_CONTEXT_PARENTS.has(parent.tagName.toLowerCase())) return true
  // text right beside the element makes it part of a line
  const siblingText = (node: ChildNode | null) =>
    node?.nodeType === 3 && (node.textContent ?? '').trim() !== ''
  return siblingText(element.previousSibling) || siblingText(element.nextSibling)
}

function rawRule(tag: string, wantsInline: boolean) {
  return {
    tag,
    priority: 60,
    getAttrs: (element: HTMLElement) =>
      sitsInText(element) === wantsInline ? { html: element.outerHTML, tag } : false,
  }
}

/** the original markup, parsed inertly, as the DOM node the serializer writes */
function markupNode(html: string): HTMLElement {
  const template = document.createElement('template')
  template.innerHTML = html
  const first = template.content.firstElementChild
  if (first instanceof HTMLElement) return first
  // SVG and MathML roots are Elements but not HTMLElements; the serializer only needs an element
  if (first) return first as unknown as HTMLElement
  return document.createElement('span')
}

/** relative src/poster/href values point at files beside the document */
function rebaseUrls(root: Element): void {
  for (const el of Array.from(root.querySelectorAll('[src], [poster]'))) {
    for (const name of ['src', 'poster']) {
      const value = el.getAttribute(name)
      if (value) el.setAttribute(name, resolveImageSrc(value))
    }
  }
}

function previewDom(node: PmNode, inline: boolean): HTMLElement {
  const tag = String(node.attrs.tag)
  const dom = document.createElement(inline ? 'span' : 'div')
  dom.className = `raw-html ${inline ? 'raw-html-inline' : 'raw-html-block'}`
  dom.title = t('rawHtmlHint')
  dom.contentEditable = 'false'
  if (PREVIEWABLE.has(tag)) {
    const template = document.createElement('template')
    template.innerHTML = String(node.attrs.html)
    // strip every handler attribute: the preview is display only
    for (const el of Array.from(template.content.querySelectorAll('*'))) {
      for (const attr of Array.from(el.attributes)) {
        if (attr.name.toLowerCase().startsWith('on')) el.removeAttribute(attr.name)
      }
      if (el.tagName.toLowerCase() === 'script') el.remove()
    }
    const holder = document.createElement(inline ? 'span' : 'div')
    holder.className = 'raw-html-preview'
    holder.append(template.content)
    rebaseUrls(holder)
    for (const media of Array.from(holder.querySelectorAll('video, audio'))) {
      ;(media as HTMLMediaElement).controls = true
      ;(media as HTMLMediaElement).autoplay = false
    }
    dom.append(holder)
    if (!inline) {
      const badge = document.createElement('span')
      badge.className = 'raw-html-badge'
      badge.textContent = `<${tag}>`
      dom.append(badge)
    }
  } else {
    const label = document.createElement('span')
    label.className = 'raw-html-label'
    label.textContent = `${t('rawHtmlLabel')} <${tag}>`
    dom.append(label)
    if (!inline) {
      const code = document.createElement('pre')
      code.className = 'raw-html-code'
      const text = String(node.attrs.html)
      code.textContent = text.length > 400 ? `${text.slice(0, 400)}…` : text
      dom.append(code)
    }
  }
  return dom
}

function rawNodeView(inline: boolean) {
  return ({ node, getPos }: { node: PmNode; getPos: () => number | undefined }): NodeView => {
    let current = node
    let dom = previewDom(node, inline)
    const wire = (el: HTMLElement) =>
      el.addEventListener('dblclick', (event) => {
        event.preventDefault()
        const pos = getPos()
        if (pos === undefined) return
        window.dispatchEvent(
          new CustomEvent<RawHtmlEditDetail>(RAW_HTML_EDIT_EVENT, {
            detail: { pos, html: String(current.attrs.html) },
          }),
        )
      })
    wire(dom)
    return {
      get dom() {
        return dom
      },
      update(next) {
        if (next.type !== current.type) return false
        if (next.attrs.html !== current.attrs.html) {
          const replacement = previewDom(next, inline)
          wire(replacement)
          dom.replaceWith(replacement)
          dom = replacement
        }
        current = next
        return true
      },
      ignoreMutation: () => true,
      // let the user operate media controls and form widgets inside the preview
      stopEvent: (event) =>
        event.type === 'dblclick' ||
        (/^(mouse|pointer)/.test(event.type) &&
          (event.target as HTMLElement).closest?.('video, audio, details, select, input, textarea, button') != null),
    }
  }
}

const rawAttrs = {
  html: { default: '' },
  tag: { default: 'div' },
}

export const RawHtmlBlock = Node.create({
  name: 'rawHtmlBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes: () => rawAttrs,
  parseHTML: () => RAW_TAGS.map((tag) => rawRule(tag, false)),
  renderHTML: ({ node }) => markupNode(String(node.attrs.html)),
  addNodeView: () => rawNodeView(false) as never,
})

export const RawHtmlInline = Node.create({
  name: 'rawHtmlInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => rawAttrs,
  parseHTML: () => RAW_TAGS.map((tag) => rawRule(tag, true)),
  renderHTML: ({ node }) => markupNode(String(node.attrs.html)),
  addNodeView: () => rawNodeView(true) as never,
})
