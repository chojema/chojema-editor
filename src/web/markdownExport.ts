import type { MarkdownExportRequest } from '../shared/ipc'

/**
 * Browser counterpart of main/markdownExport.ts. A web page cannot see the
 * folders of the source or the destination, so relative links stay as they
 * were authored (correct when the .md lands beside the source); only an
 * absolute <base href> is applied.
 */
export function markdownForWeb(request: MarkdownExportRequest): string {
  let base: URL | null = null
  if (request.baseHref) {
    try {
      base = new URL(request.baseHref)
    } catch {
      // a relative base cannot be resolved without the source location
    }
  }
  let markdown = request.markdown
  for (const { placeholder, url } of request.links) {
    let target = url
    if (base && !url.startsWith('#')) {
      try {
        target = new URL(url, base).href
      } catch {
        // keep the authored reference
      }
    }
    // Safe in both Markdown destinations and preserved HTML attributes.
    target = target.replace(/[\s<>"'()\\|]/g, (char) => encodeURIComponent(char).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    markdown = markdown.split(placeholder).join(target)
  }
  return markdown
}
