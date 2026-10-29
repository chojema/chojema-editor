/**
 * EditorApi for the browser build: the same contract the Electron preload
 * fulfils over IPC, implemented with web platform APIs. Each tab holds one
 * document, as each desktop window does.
 */

import { mainText } from '../main/strings'
import { decodeText, type TextEncoding } from '../shared/encoding'
import {
  DEFAULT_EXTENSION,
  docKindForPath,
  type DocKind,
  type EditorApi,
  type ExportRequest,
  type InitialDoc,
  type MenuCommand,
  type SaveResult,
} from '../shared/ipc'
import { resolveLanguage, type Language, type LanguagePreference } from '../shared/language'
import {
  canWriteFiles,
  DOCUMENT_TYPES,
  download,
  fileToDataUrl,
  pickFiles,
  pickSaveHandle,
  saveNewFile,
  writeHandle,
  type FileHandle,
  type OpenedFile,
} from './files'
import { markdownForWeb } from './markdownExport'
import { closeMenu, isMenuOpen, popupMenu, type MenuEntry } from './menu'
import { deleteItem, getItem, randomId, readPref, setItem, tabId, writePref } from './store'

const APP_NAME = 'Chojema Editor'
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform)

/** what a tab keeps across reloads (Save As into another format and kind switches reload) */
interface Session {
  name: string | null
  kind: DocKind
  content: string
  encoding: TextEncoding
  handleId: string | null
}

/** a file handed from one tab to a new one */
interface PendingOpen {
  name: string
  content: string
  encoding: TextEncoding
  handle: FileHandle | null
}

const SESSION_KEY = () => `session:${tabId()}`

let session: Session = blankSession('markdown')
let handle: FileHandle | null = null
let dirty = false

// ---- preferences (localStorage; other tabs follow through the storage event) ----

const PREF = { language: 'chojema.language', autoCopy: 'chojema.autoCopy', autoComplete: 'chojema.autoComplete' }

function languagePref(): LanguagePreference {
  const value = readPref(PREF.language)
  return value === 'ko' || value === 'en' ? value : 'system'
}

function currentLanguage(): Language {
  return resolveLanguage(languagePref(), navigator.language)
}

const autoCopyPref = () => readPref(PREF.autoCopy) === '1'
const autoCompletePref = () => readPref(PREF.autoComplete) !== '0'

function mt(key: keyof typeof mainText): string {
  return currentLanguage() === 'ko' ? key : mainText[key]
}

type Listener<T> = (value: T) => void
const languageListeners = new Set<Listener<Language>>()
const autoCopyListeners = new Set<Listener<boolean>>()
const autoCompleteListeners = new Set<Listener<boolean>>()
const menuListeners = new Set<Listener<MenuCommand>>()

function subscribe<T>(set: Set<Listener<T>>, handler: Listener<T>): () => void {
  set.add(handler)
  return () => set.delete(handler)
}

function emit<T>(set: Set<Listener<T>>, value: T): void {
  for (const handler of set) handler(value)
}

function setLanguagePref(language: LanguagePreference): void {
  writePref(PREF.language, language)
  applyLanguage()
}

function applyLanguage(): void {
  document.documentElement.lang = currentLanguage()
  refreshTitle()
  emit(languageListeners, currentLanguage())
}

function setAutoCopy(on: boolean): void {
  writePref(PREF.autoCopy, on ? '1' : '0')
  emit(autoCopyListeners, on)
}

function setAutoComplete(on: boolean): void {
  writePref(PREF.autoComplete, on ? '1' : '0')
  emit(autoCompleteListeners, on)
}

window.addEventListener('storage', (event) => {
  if (event.key === PREF.language) applyLanguage()
  else if (event.key === PREF.autoCopy) emit(autoCopyListeners, autoCopyPref())
  else if (event.key === PREF.autoComplete) emit(autoCompleteListeners, autoCompletePref())
})

// ---- the tab's document ----

function blankSession(kind: DocKind): Session {
  return { name: null, kind, content: '', encoding: 'UTF-8', handleId: null }
}

function untitledName(kind: DocKind): string {
  return `${mt('제목 없음')}.${DEFAULT_EXTENSION[kind]}`
}

function displayName(): string {
  return session.name ?? untitledName(session.kind)
}

function refreshTitle(): void {
  document.title = `${dirty ? '● ' : ''}${displayName()} — ${APP_NAME}`
}

function isEmptyTab(): boolean {
  return session.name === null && !dirty
}

async function storeSession(next: Session): Promise<void> {
  session = next
  await setItem(SESSION_KEY(), next)
}

async function storeHandle(next: FileHandle | null): Promise<string | null> {
  handle = next
  if (!next) return null
  const id = randomId()
  await setItem(`handle:${id}`, next)
  return id
}

async function readOpened({ file, handle: fileHandle }: OpenedFile): Promise<PendingOpen> {
  const { text, encoding } = decodeText(new Uint8Array(await file.arrayBuffer()))
  return { name: file.name, content: text, encoding, handle: fileHandle }
}

/** Load the document a tab starts with: a file handed over, a new kind, or the one before a reload. */
async function initialSession(): Promise<Session> {
  const params = new URLSearchParams(location.search)
  const openId = params.get('open')
  const newKind = params.get('new')
  if (openId || newKind) history.replaceState(null, '', location.pathname)
  if (openId) {
    const pending = await getItem<PendingOpen>(`open:${openId}`)
    await deleteItem(`open:${openId}`)
    if (pending) {
      const handleId = await storeHandle(pending.handle)
      return { name: pending.name, kind: docKindForPath(pending.name), content: pending.content, encoding: pending.encoding, handleId }
    }
  }
  if (newKind === 'text' || newKind === 'markdown' || newKind === 'html') return blankSession(newKind)
  const saved = await getItem<Session>(SESSION_KEY())
  if (!saved) return blankSession('markdown')
  handle = saved.handleId ? ((await getItem<FileHandle>(`handle:${saved.handleId}`)) ?? null) : null
  return saved
}

function openTab(query: string): void {
  window.open(`${location.pathname}?${query}`, '_blank')
}

/** an untouched untitled tab takes the first file; every other file opens in a new tab */
async function openFiles(files: OpenedFile[]): Promise<void> {
  const docs = await Promise.all(files.map(readOpened))
  const here = isEmptyTab() ? docs.shift() : undefined
  for (const doc of docs) {
    const id = randomId()
    await setItem(`open:${id}`, doc)
    openTab(`open=${id}`)
  }
  if (here) {
    const handleId = await storeHandle(here.handle)
    await storeSession({ name: here.name, kind: docKindForPath(here.name), content: here.content, encoding: here.encoding, handleId })
    location.reload()
  }
}

async function openWithDialog(): Promise<void> {
  try {
    await openFiles(await pickFiles({ accept: '.md,.markdown,.html,.htm,.txt,text/*', types: DOCUMENT_TYPES, multiple: true }))
  } catch (error) {
    alert(String(error))
  }
}

function newDocument(kind: DocKind): void {
  if (!isEmptyTab()) {
    openTab(`new=${kind}`)
    return
  }
  if (session.kind === kind) return
  void storeSession(blankSession(kind)).then(() => location.reload())
}

// ---- saving ----

const SAVE_TYPES: Record<DocKind, { description: string; accept: Record<string, string[]> }> = {
  text: { description: 'Text', accept: { 'text/plain': ['.txt'] } },
  markdown: { description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown'] } },
  html: { description: 'HTML', accept: { 'text/html': ['.html', '.htm'] } },
}

const MIME: Record<DocKind, string> = { text: 'text/plain', markdown: 'text/markdown', html: 'text/html' }

function confirmUtf8(): boolean {
  if (session.encoding === 'UTF-8') return true
  return confirm(
    `${mt('이 파일은 {encoding} 방식으로 저장되어 있습니다.').replace('{encoding}', session.encoding)}\n\n` +
      mt('Chojema Editor는 UTF-8로 저장합니다. 이 파일을 옛 방식으로만 읽는 프로그램에서는 한글이 깨져 보일 수 있습니다.'),
  )
}

/** record a finished save; Save As into another known format switches the tab's kind */
async function saved(name: string, content: string, handleId: string | null): Promise<SaveResult> {
  const kind = /\.(md|markdown|html?|txt)$/i.test(name) ? docKindForPath(name) : session.kind
  await storeSession({ name, kind, content, encoding: 'UTF-8', handleId })
  refreshTitle()
  return { ok: true, path: name, encoding: 'UTF-8' }
}

async function saveTo(target: FileHandle, content: string, handleId: string | null): Promise<SaveResult> {
  if (!(await writeHandle(target, content))) return { ok: false }
  return saved(target.name, content, handleId)
}

async function saveAs(content: string, kind: DocKind): Promise<SaveResult> {
  if (!confirmUtf8()) return { ok: false }
  const suggested = session.name ?? untitledName(kind)
  try {
    if (!canWriteFiles) {
      download(suggested, content, MIME[kind])
      return saved(suggested, content, null)
    }
    const picked = await pickSaveHandle(suggested, [SAVE_TYPES[kind]])
    if (!picked) return { ok: false }
    return saveTo(picked, content, await storeHandle(picked))
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function save(content: string, kind: DocKind): Promise<SaveResult> {
  if (!handle) return saveAs(content, kind)
  if (!confirmUtf8()) return { ok: false }
  try {
    return await saveTo(handle, content, session.handleId)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

// ---- export ----

function exportName(ext: string): string {
  return `${displayName().replace(/\.[^.]+$/, '')}.${ext}`
}

async function exportFile(ext: string, data: string, type: { description: string; mime: string }): Promise<SaveResult> {
  try {
    const name = await saveNewFile(exportName(ext), data, { ...type, ext })
    return name ? { ok: true, path: name } : { ok: false }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}

/**
 * Print a finished page from a hidden frame. The frame is sandboxed without
 * scripts, as the desktop export window runs with JavaScript off.
 */
function printPage(request: ExportRequest): Promise<void> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe')
    frame.setAttribute('sandbox', 'allow-same-origin allow-modals')
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden'
    frame.addEventListener('load', () => {
      const view = frame.contentWindow
      const done = () => {
        frame.remove()
        resolve()
      }
      if (!view) return done()
      view.addEventListener('afterprint', done, { once: true })
      view.focus()
      view.print()
      // some browsers return from print() without firing afterprint
      setTimeout(() => frame.isConnected && done(), 60_000)
    })
    frame.srcdoc = request.html
    document.body.appendChild(frame)
  })
}

// ---- menu and shortcuts (the desktop native menu's job) ----

const MOD = IS_MAC ? '⌘' : 'Ctrl+'
const SHIFT = IS_MAC ? '⇧' : 'Shift+'

function sendMenu(command: MenuCommand): void {
  emit(menuListeners, command)
}

function kindLabel(kind: DocKind): string {
  return kind === 'text' ? mt('텍스트') : kind === 'markdown' ? 'Markdown' : 'HTML'
}

function showMenu(): void {
  if (isMenuOpen()) {
    closeMenu()
    return
  }
  const language = languagePref()
  const entries: MenuEntry[] = [
    { type: 'header', label: isEmptyTab() ? mt('이 창을 다음 문서로 바꾸기') : mt('새 창에서 시작') },
    ...(['text', 'markdown', 'html'] as const).map((kind) => ({
      label: `${kindLabel(kind)} ${mt('문서')}`,
      checked: session.kind === kind,
      click: () => newDocument(kind),
    })),
    { type: 'separator' },
    { label: mt('열기…'), shortcut: `${MOD}O`, click: () => void openWithDialog() },
    { label: mt('저장'), shortcut: `${MOD}S`, click: () => sendMenu('save') },
    { label: mt('다른 이름으로 저장…'), shortcut: `${MOD}${SHIFT}S`, click: () => sendMenu('saveAs') },
    { type: 'separator' },
    { label: mt('HTML로 저장…'), click: () => sendMenu('exportHtml') },
    { label: mt('Markdown으로 저장…'), enabled: session.kind === 'html', click: () => sendMenu('exportMarkdown') },
    { label: mt('서식 있는 텍스트로 복사'), click: () => sendMenu('copyRich') },
    { label: mt('PDF로 내보내기…'), shortcut: `${MOD}${SHIFT}E`, click: () => sendMenu('exportPdf') },
    { label: mt('인쇄…'), shortcut: `${MOD}P`, click: () => sendMenu('print') },
    { type: 'separator' },
    { label: mt('소스 자동 완성'), checked: autoCompletePref(), click: () => setAutoComplete(!autoCompletePref()) },
    { type: 'header', label: mt('언어') },
    ...(['system', 'ko', 'en'] as const).map((value) => ({
      label: { system: mt('시스템 설정 따르기'), ko: '한국어', en: 'English' }[value],
      checked: language === value,
      click: () => setLanguagePref(value),
    })),
  ]
  popupMenu(entries, document.querySelector('.status-kind'))
}

/** desktop menu accelerators; matched on the physical key so a Korean IME layout still works */
function installShortcuts(): void {
  window.addEventListener(
    'keydown',
    (event) => {
      const mod = IS_MAC ? event.metaKey : event.ctrlKey
      const shift = event.shiftKey
      const alt = event.altKey
      let command: MenuCommand | 'open' | null = null
      if (mod && !alt) {
        command =
          (
            {
              KeyS: shift ? 'saveAs' : 'save',
              KeyO: shift ? 'toggleOutline' : 'open',
              KeyE: shift ? 'exportPdf' : null,
              KeyP: shift ? null : 'print',
              KeyF: shift ? null : 'find',
              Digit1: 'viewVisual',
              Digit2: 'viewSplit',
              Digit3: 'viewSource',
              Slash: 'toggleSource',
              Equal: 'zoomIn',
              Minus: 'zoomOut',
              Digit0: 'zoomReset',
            } as Record<string, MenuCommand | 'open' | null>
          )[event.code] ?? null
      } else if (mod && alt && !shift && event.code === 'KeyF') {
        command = 'replace'
      } else if (alt && !mod && !shift && event.code === 'KeyZ') {
        command = 'toggleWrap'
      }
      if (!command) return
      event.preventDefault()
      event.stopPropagation()
      if (command === 'open') void openWithDialog()
      else sendMenu(command)
    },
    true,
  )
}

// ---- the API ----

/** dropped File objects stand in for filesystem paths until openPaths takes them */
const droppedFiles = new Map<string, File>()

function createWebApi(): EditorApi {
  return {
    async getInitialDoc(): Promise<InitialDoc> {
      await storeSession(await initialSession())
      refreshTitle()
      document.documentElement.lang = currentLanguage()
      return {
        language: currentLanguage(),
        path: session.name,
        kind: session.kind,
        content: session.content,
        encoding: session.encoding,
        autoCopy: autoCopyPref(),
        autoComplete: autoCompletePref(),
      }
    },
    save,
    saveAs,
    setDirty(next) {
      dirty = next
      refreshTitle()
    },
    // without a folder to write into, pictures travel inside the document
    async saveImage({ base64, ext }) {
      const mime = ext === 'jpg' ? 'jpeg' : ext
      return `data:image/${mime};base64,${base64}`
    },
    async pickImage() {
      const [picked] = await pickFiles({
        accept: 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml',
        types: [{ description: mt('이미지'), accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'] } }],
        multiple: false,
      })
      return picked ? fileToDataUrl(picked.file) : null
    },
    // a page cannot read files beside the document it was given
    readAsset: async () => null,
    showKindMenu: showMenu,
    openPaths(paths) {
      const files = paths.flatMap((key) => {
        const file = droppedFiles.get(key)
        droppedFiles.delete(key)
        return file ? [{ file, handle: null }] : []
      })
      if (files.length) void openFiles(files)
    },
    pathForFile(file) {
      const key = `web-file:${randomId()}`
      droppedFiles.set(key, file)
      return key
    },
    exportMarkdown: (request) =>
      exportFile('md', markdownForWeb(request), { description: 'Markdown', mime: 'text/markdown' }),
    exportHtml: (request) => exportFile('html', request.html, { description: 'HTML', mime: 'text/html' }),
    // browsers make PDFs only through the print dialog ("Save as PDF")
    async exportPdf(request) {
      await printPage(request)
      return { ok: false }
    },
    print: printPage,
    copyRich(html, text) {
      const plain = () => void navigator.clipboard.writeText(text).catch(() => {})
      if (typeof ClipboardItem === 'undefined') return plain()
      const item = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })
      void navigator.clipboard.write([item]).catch(plain)
    },
    setAutoCopy,
    onAutoCopyChanged: (handler) => subscribe(autoCopyListeners, handler),
    onLanguageChanged: (handler) => subscribe(languageListeners, handler),
    onAutoCompleteChanged: (handler) => subscribe(autoCompleteListeners, handler),
    onMenuCommand: (handler) => subscribe(menuListeners, handler),
    // a closing tab cannot wait for a save; the beforeunload prompt guards unsaved edits instead
    onSaveBeforeClose: () => () => {},
  }
}

export function installWebApi(): void {
  window.editorApi = createWebApi()
  installShortcuts()
  window.addEventListener('beforeunload', (event) => {
    if (!dirty) return
    event.preventDefault()
    event.returnValue = ''
  })
}
