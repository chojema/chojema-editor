import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import type { MarkdownExportRequest } from '../../shared/ipc'

/** Convert a detached snapshot, never the live editor DOM. */
export function htmlToMarkdown(html: string): MarkdownExportRequest {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const baseHref = doc.querySelector('base[href]')?.getAttribute('href') ?? null
  const links: MarkdownExportRequest['links'] = []
  const tokenPrefix = `export-link-${crypto.randomUUID()}-`
  // Markdown represents document content, not page scripts or interactive embeds.
  doc.querySelectorAll('script, style, template, noscript, iframe, object, embed, svg, canvas, button, select, textarea').forEach((el) => el.remove())
  for (const el of Array.from(doc.body.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name) || ['style', 'srcdoc'].includes(attr.name) || (attr.name === 'class' && el.tagName !== 'CODE')) el.removeAttribute(attr.name)
    }
    for (const attr of ['href', 'src']) {
      const url = el.getAttribute(attr)
      if (!url) continue
      if (/^(?:javascript|vbscript):/i.test(url.replace(/[\u0000-\u0020]/g, '')) || (/^data:/i.test(url) && !/^data:image\//i.test(url))) {
        el.removeAttribute(attr)
        continue
      }
      const placeholder = `${tokenPrefix}${links.length}-end`
      links.push({ placeholder, url })
      el.setAttribute(attr, placeholder)
    }
  }
  const tasks: Array<{ placeholder: string; marker: string }> = []
  // TipTap wraps task checkboxes in labels; use the list item's saved state too.
  for (const li of Array.from(doc.body.querySelectorAll('li'))) {
    const input = li.querySelector('input[type="checkbox"]')
    if (input?.closest('li') !== li && !li.hasAttribute('data-checked')) continue
    const checked = li.getAttribute('data-checked') === 'true' || input?.hasAttribute('checked')
    input?.remove()
    const placeholder = `${tokenPrefix}task-${tasks.length}-end`
    tasks.push({ placeholder, marker: checked ? '[x]' : '[ ]' })
    const paragraph = li.querySelector('p')
    const target = paragraph?.closest('li') === li ? paragraph : li
    target.insertBefore(doc.createTextNode(`${placeholder} `), target.firstChild)
  }
  doc.body.querySelectorAll('input').forEach((el) => el.remove())

  const service = new TurndownService({
    headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced', emDelimiter: '*',
  })
  service.use(gfm)
  service.addRule('strike', { filter: (node) => ['DEL', 'S', 'STRIKE'].includes(node.nodeName), replacement: (content) => `~~${content}~~` })
  service.addRule('pre', {
    filter: 'pre',
    replacement: (_content, node) => {
      const code = node.textContent ?? ''
      const language = node.querySelector('code')?.getAttribute('class')?.match(/language-([\w+-]+)/)?.[1] ?? ''
      const fence = '`'.repeat(Math.max(3, ...Array.from(code.matchAll(/`+/g), (match) => match[0].length + 1)))
      return `\n\n${fence}${language}\n${code.replace(/\n$/, '')}\n${fence}\n\n`
    },
  })
  service.addRule('table', {
    filter: 'table',
    replacement: (_content, node) => {
      const table = node as HTMLTableElement
      const rows = Array.from(table.rows)
      if (!rows.length) return ''
      const width = rows[0]!.cells.length
      // Merged, nested or irregular tables cannot be represented faithfully by GFM.
      if (!width || table.querySelector('table') || rows.some((row) => row.cells.length !== width ||
        Array.from(row.cells).some((cell) => cell.colSpan !== 1 || cell.rowSpan !== 1))) {
        return `\n\n${table.outerHTML}\n\n`
      }
      const values = rows.map((row) => Array.from(row.cells, (cell) =>
        service.turndown(cell.innerHTML).replace(/\r?\n/g, '<br>').replace(/\|/g, '\\|')))
      const hasHeader = Array.from(rows[0]!.cells).every((cell) => cell.tagName === 'TH') || rows[0]!.parentElement?.tagName === 'THEAD'
      if (!hasHeader) values.unshift(Array(width).fill(''))
      values.splice(1, 0, Array(width).fill('---'))
      return `\n\n${values.map((cells) => `| ${cells.join(' | ')} |`).join('\n')}\n\n`
    },
  })
  let markdown = service.turndown(doc.body)
  for (const { placeholder, marker } of tasks) markdown = markdown.split(placeholder).join(marker)
  return { markdown: markdown ? `${markdown}\n` : '', links, baseHref }
}
