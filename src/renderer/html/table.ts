import { DOMParser as PmParser, DOMSerializer, type Node as PmNode } from '@tiptap/pm/model'
import { Table, TableRow } from '@tiptap/extension-table'

export interface TableSection { tag: string; attrs: Record<string, string>; key: number }
export interface TableExtras { caption: string | null; columns: string[] }
const attributes = (el: Element) => Object.fromEntries(Array.from(el.attributes, a => [a.name, a.value]))

function extras(el: Element): TableExtras {
  const children = Array.from(el.children)
  return {
    caption: children.find(child => child.tagName === 'CAPTION')?.outerHTML ?? null,
    columns: children.filter(child => child.tagName === 'COLGROUP').map(child => child.outerHTML),
  }
}

function appendMarkup(parent: HTMLElement, markup: string) {
  const template = document.createElement('template')
  template.innerHTML = markup
  parent.append(template.content)
}

/** TableMap needs direct row children; section membership travels with each row. */
export const HtmlTableRow = TableRow.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      htmlSection: {
        default: null,
        rendered: false,
        parseHTML: (row: HTMLElement): TableSection | null => {
          const parent = row.parentElement
          if (!parent || !/^(THEAD|TBODY|TFOOT)$/.test(parent.tagName)) return null
          return { tag: parent.tagName.toLowerCase(), attrs: attributes(parent), key: Array.from(parent.parentElement?.children ?? []).indexOf(parent) }
        },
      },
    }
  },
})

/** Preserve captions, column definitions and row sections without putting them in TableMap's grid. */
export const HtmlTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      htmlTableExtras: { default: null, rendered: false, parseHTML: (el: HTMLElement) => extras(el) },
    }
  },
  parseHTML() {
    return [{
      tag: 'table',
      getContent: (element, schema) => {
        const clone = element.cloneNode(true) as HTMLElement
        for (const child of Array.from(clone.children)) {
          if (!/^(TR|THEAD|TBODY|TFOOT)$/.test(child.tagName)) child.remove()
        }
        return PmParser.fromSchema(schema).parse(clone, { topNode: schema.nodes.table.create() }).content
      },
    }]
  },
  renderHTML({ node, HTMLAttributes }) {
    const table = document.createElement('table')
    for (const [name, value] of Object.entries(HTMLAttributes)) if (value != null) table.setAttribute(name, String(value))
    const meta = node.attrs.htmlTableExtras as TableExtras | null
    if (meta?.caption) appendMarkup(table, meta.caption)
    for (const group of meta?.columns ?? []) appendMarkup(table, group)
    const serializer = DOMSerializer.fromSchema(node.type.schema)
    let group: HTMLElement | null = null, lastKey = ''
    node.forEach(row => {
      const section = row.attrs.htmlSection as TableSection | null
      const key = section ? JSON.stringify(section) : 'default'
      if (!group || key !== lastKey) {
        group = document.createElement(section?.tag ?? 'tbody')
        for (const [name, value] of Object.entries(section?.attrs ?? {})) group.setAttribute(name, value)
        table.append(group)
        lastKey = key
      }
      group.append(serializer.serializeNode(row))
    })
    return table
  },
  addNodeView() {
    return ({ node, HTMLAttributes }) => {
      const table = document.createElement('table'), body = document.createElement('tbody')
      table.append(body)
      let current: PmNode = node
      const refresh = () => {
        for (const name of table.getAttributeNames()) table.removeAttribute(name)
        for (const [name, value] of Object.entries({ ...HTMLAttributes, ...current.attrs.htmlAttrs })) if (value != null) table.setAttribute(name, String(value))
        for (const child of Array.from(table.children)) if (child !== body) child.remove()
        const meta = current.attrs.htmlTableExtras as TableExtras | null
        if (meta?.caption) {
          const temp = document.createElement('template'); temp.innerHTML = meta.caption
          const caption = document.createElement('caption')
          caption.textContent = temp.content.textContent
          caption.contentEditable = 'false'
          table.insertBefore(caption, body)
        }
        for (const markup of meta?.columns ?? []) {
          const temp = document.createElement('template'); temp.innerHTML = markup
          // Keep column layout in the editing view, without copying event handlers.
          for (const element of Array.from(temp.content.querySelectorAll('*'))) {
            for (const attr of Array.from(element.attributes)) if (/^on/i.test(attr.name)) element.removeAttribute(attr.name)
          }
          table.insertBefore(temp.content, body)
        }
      }
      refresh()
      return {
        dom: table, contentDOM: body,
        update(next) {
          if (next.type !== current.type) return false
          if (next.attrs !== current.attrs) { current = next; refresh() } else current = next
          return true
        },
        ignoreMutation: mutation => mutation.type !== 'selection' && !body.contains(mutation.target),
      }
    }
  },
}).configure({ resizable: false })
