import { Node } from '@tiptap/core'
import { t } from '../i18n/locale'
import { resolveImageSrc } from './localImage'

function needsHtml(table: Element): boolean {
  if (table.attributes.length || table.querySelector('caption,colgroup,thead,tfoot,table')) return true
  const rows = Array.from(table.querySelectorAll('tr'))
  return rows.some((row, index) => row.attributes.length || Array.from(row.children).some(cell =>
    cell.tagName !== (index === 0 ? 'TH' : 'TD') || Array.from(cell.attributes).some(attr => !/^(colspan|rowspan)$/.test(attr.name) || attr.value !== '1') ||
    cell.querySelector('table,ul,ol,pre,div,section') || cell.querySelectorAll(':scope > p').length > 1))
}

/** Complex HTML tables in Markdown remain intact and are edited in source. */
export const PreservedHtmlTable = Node.create({
  name: 'preservedHtmlTable', group: 'block', atom: true, selectable: true,
  addAttributes: () => ({ html: { default: '' } }),
  parseHTML: () => [{ tag: 'table', priority: 100, getAttrs: (element: HTMLElement) => needsHtml(element) ? { html: element.outerHTML } : false }],
  renderHTML({ node }) {
    const template = document.createElement('template'); template.innerHTML = String(node.attrs.html)
    return template.content.firstElementChild ?? document.createElement('table')
  },
  markdownTokenName: 'html',
  parseMarkdown(token, helpers) {
    const raw = String(token.raw ?? token.text ?? '')
    if (!/^\s*<table\b/i.test(raw)) return []
    const template = document.createElement('template'); template.innerHTML = raw
    const table = template.content.firstElementChild
    if (template.content.children.length !== 1 || table?.tagName !== 'TABLE' || !needsHtml(table)) return []
    return helpers.createNode('preservedHtmlTable', { html: raw.trim() })
  },
  renderMarkdown: node => String(node.attrs?.html ?? ''),
  addNodeView: () => ({ node }) => {
    const dom = document.createElement('div')
    dom.className = 'preserved-html-table'
    dom.contentEditable = 'false'
    const label = document.createElement('div'); label.className = 'preserved-table-label'; label.textContent = t('tableSourceOnly')
    const preview = document.createElement('div'); preview.innerHTML = String(node.attrs.html)
    for (const unsafe of Array.from(preview.querySelectorAll('script,style,iframe,object,embed,link,meta'))) unsafe.remove()
    for (const element of Array.from(preview.querySelectorAll('*'))) {
      for (const attr of Array.from(element.attributes)) if (/^on/i.test(attr.name) || /^(href|src|srcdoc)$/i.test(attr.name) && /^\s*javascript:/i.test(attr.value)) element.removeAttribute(attr.name)
      const src = element.getAttribute('src'); if (src) element.setAttribute('src', resolveImageSrc(src))
    }
    dom.append(label, preview)
    return { dom, ignoreMutation: () => true }
  },
})
