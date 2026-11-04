import { net, protocol } from 'electron'
import { randomBytes } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Run preview for HTML documents. The renderer hands main the current text;
 * a sandboxed iframe then loads it from chojema-preview://<token>/<file name>,
 * so the page runs with its own origin and no CSP of the editor's, and its
 * relative links (scripts, styles, images, fetch) resolve to files beside the
 * document. Each window gets an unguessable host, and only files inside the
 * document's folder are served.
 */

export const PREVIEW_SCHEME = 'chojema-preview'

/** files a web page may load from beside it */
const SERVABLE_EXTS = new Set([
  '.html', '.htm', '.xhtml', '.css', '.js', '.mjs', '.cjs', '.json', '.map', '.wasm',
  '.txt', '.csv', '.tsv', '.xml', '.md',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif',
  '.woff', '.woff2', '.ttf', '.otf',
  '.mp4', '.webm', '.ogg', '.ogv', '.mp3', '.wav', '.m4a', '.aac', '.flac', '.vtt',
])

interface Preview {
  token: string
  html: string
}

const previews = new Map<number, Preview>()

/** must run before the app is ready */
export function registerPreviewScheme(): { scheme: string; privileges: Electron.CustomScheme['privileges'] } {
  return {
    scheme: PREVIEW_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  }
}

function isInside(target: string, dir: string): boolean {
  const rel = relative(dir, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** the page is a sandboxed frame with an opaque origin: let it read what it is allowed to load */
function headers(extra: Record<string, string> = {}): Headers {
  return new Headers({ 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', ...extra })
}

/** the document's file name in the preview URL; an untitled one is index.html */
function pageName(docPath: string | null): string {
  return docPath ? basename(docPath) : 'index.html'
}

/** remember the window's current text; returns the URL that shows it */
export function setPreview(windowId: number, html: string, docPath: string | null): string {
  let preview = previews.get(windowId)
  if (!preview) {
    preview = { token: randomBytes(16).toString('hex'), html }
    previews.set(windowId, preview)
  }
  preview.html = html
  return `${PREVIEW_SCHEME}://${preview.token}/${encodeURIComponent(pageName(docPath))}`
}

export function dropPreview(windowId: number): void {
  previews.delete(windowId)
}

export function registerPreviewProtocol(docPathOf: (windowId: number) => string | null | undefined): void {
  protocol.handle(PREVIEW_SCHEME, async (request) => {
    let url: URL
    let path: string
    try {
      url = new URL(request.url)
      path = decodeURIComponent(url.pathname)
    } catch {
      return new Response(null, { status: 400 })
    }
    const entry = [...previews.entries()].find(([, preview]) => preview.token === url.hostname)
    if (!entry) return new Response(null, { status: 404 })
    const [windowId, preview] = entry
    const docPath = docPathOf(windowId) ?? null

    // the document itself comes from the editor, not from disk, so unsaved edits run
    if (path === '/' || path === `/${pageName(docPath)}`) {
      return new Response(preview.html, { headers: headers({ 'Content-Type': 'text/html; charset=utf-8' }) })
    }
    if (!docPath) return new Response(null, { status: 404 })
    const dir = resolve(dirname(docPath))
    const target = resolve(dir, `.${path}`)
    if (!isInside(target, dir)) return new Response(null, { status: 403 })
    if (!SERVABLE_EXTS.has(extname(target).toLowerCase()) || !existsSync(target) || !statSync(target).isFile()) {
      return new Response(null, { status: 404 })
    }
    const file = await net.fetch(pathToFileURL(target).toString())
    const type = file.headers.get('Content-Type')
    return new Response(file.body, {
      status: file.status,
      headers: headers(type ? { 'Content-Type': type } : {}),
    })
  })
}
