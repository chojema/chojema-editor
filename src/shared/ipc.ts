/** Contract between the main process, the preload bridge and the renderer. */

/** pasted / dropped images above this size are refused instead of copied into assets/ */
export const MAX_PASTED_IMAGE_BYTES = 20 * 1024 * 1024

/** which editing surface a document opens on */
export type DocKind = 'text' | 'markdown' | 'html'

export function docKindForPath(path: string | null | undefined): DocKind {
  const ext = (path ?? '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? ''
  if (ext === 'md' || ext === 'markdown' || ext === 'mdown' || ext === 'mkd') return 'markdown'
  if (ext === 'html' || ext === 'htm' || ext === 'xhtml') return 'html'
  return 'text'
}

export const DEFAULT_EXTENSION: Record<DocKind, string> = {
  text: 'txt',
  markdown: 'md',
  html: 'html',
}

/** what a window starts with: a file from disk, or an untitled document of a kind */
export interface InitialDoc {
  path: string | null
  kind: DocKind
  /** file text as read from disk ('' for an untitled document) */
  content: string
}

export interface SaveResult {
  ok: boolean
  /** the path written; changes when Save As picked a new one */
  path?: string
  error?: string
}

/** menu commands the main process forwards to the focused window */
export type MenuCommand =
  | 'save'
  | 'saveAs'
  | 'toggleSource'
  | 'find'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  | 'toggleWrap'

export interface EditorApi {
  getInitialDoc(): Promise<InitialDoc>
  /** write `content` to the current path, or ask for one when the document is untitled */
  save(content: string, kind: DocKind): Promise<SaveResult>
  saveAs(content: string, kind: DocKind): Promise<SaveResult>
  setDirty(dirty: boolean): void
  /** copy a pasted image next to the document; returns the relative path, or null when untitled */
  saveImage(input: { base64: string; ext: string }): Promise<string | null>
  /** pick an image file; returns a path relative to the document when possible */
  pickImage(): Promise<string | null>
  /** read a stylesheet or other text asset next to an HTML document */
  readAsset(relPath: string): Promise<string | null>
  onMenuCommand(handler: (command: MenuCommand) => void): () => void
  /** main asks the renderer to save before the window closes; reply with the outcome */
  onSaveBeforeClose(handler: () => Promise<boolean>): () => void
  onChromePressed?(handler: () => void): () => void
}

export const IPC = {
  getInitialDoc: 'doc:get-initial',
  save: 'doc:save',
  saveAs: 'doc:save-as',
  setDirty: 'doc:set-dirty',
  saveImage: 'doc:save-image',
  pickImage: 'doc:pick-image',
  readAsset: 'doc:read-asset',
  menuCommand: 'menu:command',
  saveBeforeClose: 'doc:save-before-close',
  saveBeforeCloseReply: 'doc:save-before-close-reply',
} as const
