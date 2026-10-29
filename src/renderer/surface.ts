import type { DocKind, ExportRequest } from '../shared/ipc'
import type { ViewMode } from './views'

/** what App needs from whichever editing surface is mounted */
export interface SurfaceHandle {
  /** the full file text as it would be written now */
  getContent(): string
  /** the text just written to disk becomes the new baseline for "unchanged" */
  markSaved(content: string): void
  setMode(mode: ViewMode): void
  /** visual ↔ source */
  toggleSource(): void
  openFind(withReplace: boolean): void
  toggleOutline(): void
  /** the document as a standalone page for HTML/PDF export and printing */
  exportPage(): Promise<ExportRequest>
  /** the document as formatted text for the clipboard */
  richCopy(): Promise<{ html: string; text: string }>
}

export interface DocStats {
  words: number
  chars: number
  lines?: number
}

export interface SurfaceProps {
  kind: DocKind
  /** file text at open ('' for an untitled document) */
  initialContent: string
  /** current file path; images and stylesheets resolve against its folder */
  path: string | null
  wrap: boolean
  zoom: number
  /** tag and attribute completions in source panes */
  autoComplete: boolean
  onDirty: () => void
  onStats: (stats: DocStats) => void
  onSave: () => void
}

/** Chinese and Japanese characters; Korean separates words with spaces */
const IDEOGRAPHS = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/g

/** words are whitespace-separated runs, except that each ideograph counts as one */
export function countWords(text: string): number {
  let words = 0
  for (const run of text.split(/\s+/)) {
    if (!run) continue
    const ideographs = run.match(IDEOGRAPHS)?.length ?? 0
    const rest = run.replace(IDEOGRAPHS, '')
    words += ideographs + (rest ? 1 : 0)
  }
  return words
}

export function statsOf(text: string): DocStats {
  return { words: countWords(text), chars: Array.from(text.replace(/\n/g, '')).length }
}
