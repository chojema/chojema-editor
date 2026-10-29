import { dirname, isAbsolute, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { MarkdownExportRequest } from '../shared/ipc'

/** Rebase links only after the destination is chosen. Never rewrite prose or code. */
export function markdownForDestination(request: MarkdownExportRequest, sourcePath: string | null, destination: string): string {
  let base = sourcePath ? pathToFileURL(sourcePath) : null
  if (request.baseHref) {
    try { base = base ? new URL(request.baseHref, base) : new URL(request.baseHref) } catch { /* unresolved relative base */ }
  }
  let markdown = request.markdown
  for (const { placeholder, url } of request.links) {
    let target = url
    if (!url.startsWith('#')) {
      try {
        const authored = url.replace(/^md-asset:/i, 'file:')
        const resolved = base ? new URL(authored, base) : new URL(authored)
        if (resolved.protocol === 'file:') {
          const rel = relative(dirname(destination), fileURLToPath(resolved))
          target = isAbsolute(rel) ? resolved.href : rel.split(sep).map(encodeURIComponent).join('/') + resolved.search + resolved.hash
        } else target = resolved.href
      } catch { /* untitled documents retain unresolved relative references */ }
    }
    // Safe in both Markdown destinations and preserved HTML attributes.
    target = target.replace(/[\s<>"'()\\|]/g, (char) => encodeURIComponent(char).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    markdown = markdown.split(placeholder).join(target)
  }
  return markdown
}
