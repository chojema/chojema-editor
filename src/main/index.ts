import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell } from 'electron'
import type { MenuItemConstructorOptions, WebContents } from 'electron'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  DEFAULT_EXTENSION,
  docKindForPath,
  IPC,
  type DocKind,
  type InitialDoc,
  type MenuCommand,
  type SaveResult,
} from '../shared/ipc'

const APP_NAME = 'Chojema Editor'

/**
 * Packaged builds take the icon from the bundle (build/icon.icns / .ico);
 * this PNG gives the dev run and Linux windows the same icon.
 */
const DEV_ICON = join(__dirname, '../../build/icon.png')

/** per-window document state; the renderer owns the text, main owns the path */
interface WindowDoc {
  path: string | null
  kind: DocKind
  dirty: boolean
  /** set once the user confirmed (or saved) so the next close goes through */
  closing: boolean
}

const docs = new Map<number, WindowDoc>()
/** files the OS asked us to open before the app was ready */
const pendingOpens: string[] = []

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'md-asset',
    privileges: { secure: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: true },
  },
])

const SERVABLE_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif',
  '.css', '.woff', '.woff2', '.ttf', '.otf',
  '.mp4', '.webm', '.ogg', '.mp3', '.wav',
])

function isInside(target: string, dir: string): boolean {
  const rel = relative(dir, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Serves files beside open documents (images, stylesheets, fonts) to the
 * editor DOM. Only files inside the directory of an open document are served.
 */
function registerAssetProtocol(): void {
  protocol.handle('md-asset', async (request) => {
    let target: string
    try {
      target = decodeURIComponent(new URL(request.url).pathname)
    } catch {
      return new Response(null, { status: 400 })
    }
    if (/^\/[a-zA-Z]:\//.test(target)) target = target.slice(1)
    target = resolve(target)
    if (!SERVABLE_EXTS.has(extname(target).toLowerCase()) || !existsSync(target)) {
      return new Response(null, { status: 404 })
    }
    const allowed = [...docs.values()].some(
      (doc) => doc.path !== null && isInside(target, resolve(dirname(doc.path))),
    )
    if (!allowed) return new Response(null, { status: 403 })
    return net.fetch(pathToFileURL(target).toString())
  })
}

function windowTitle(doc: WindowDoc): string {
  const name = doc.path ? basename(doc.path) : untitledName(doc.kind)
  return `${doc.dirty ? '● ' : ''}${name} — ${APP_NAME}`
}

function untitledName(kind: DocKind): string {
  return `Untitled.${DEFAULT_EXTENSION[kind]}`
}

function refreshTitle(win: BrowserWindow): void {
  const doc = docs.get(win.id)
  if (!doc) return
  win.setTitle(windowTitle(doc))
  win.setRepresentedFilename(doc.path ?? '')
  win.setDocumentEdited(doc.dirty)
}

function docFor(sender: WebContents): { win: BrowserWindow; doc: WindowDoc } | null {
  const win = BrowserWindow.fromWebContents(sender)
  const doc = win ? docs.get(win.id) : undefined
  return win && doc ? { win, doc } : null
}

function createWindow(path: string | null, kind: DocKind = docKindForPath(path)): BrowserWindow {
  // a file that is already open just comes to the front
  if (path) {
    for (const [id, doc] of docs) {
      if (doc.path === path) {
        const existing = BrowserWindow.fromId(id)
        if (existing) {
          existing.show()
          existing.focus()
          return existing
        }
      }
    }
  }
  const focused = BrowserWindow.getFocusedWindow()
  const win = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 560,
    minHeight: 400,
    show: false,
    title: APP_NAME,
    ...(process.platform !== 'darwin' && existsSync(DEV_ICON) ? { icon: DEV_ICON } : {}),
    ...(focused ? { x: focused.getBounds().x + 24, y: focused.getBounds().y + 24 } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })
  docs.set(win.id, { path, kind, dirty: false, closing: false })
  refreshTitle(win)

  win.once('ready-to-show', () => win.show())
  // the window title names the document, not the renderer page's <title>
  win.on('page-title-updated', (event) => event.preventDefault())

  // links never navigate the editor window: web pages go to the browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })

  win.on('close', (event) => {
    const doc = docs.get(win.id)
    if (!doc || doc.closing || !doc.dirty) return
    event.preventDefault()
    void confirmClose(win, doc)
  })
  const id = win.id
  win.on('closed', () => docs.delete(id))

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  if (path) app.addRecentDocument(path)
  return win
}

async function confirmClose(win: BrowserWindow, doc: WindowDoc): Promise<void> {
  const name = doc.path ? basename(doc.path) : untitledName(doc.kind)
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['저장', '저장 안 함', '취소'],
    defaultId: 0,
    cancelId: 2,
    message: `'${name}'의 변경 내용을 저장할까요?`,
    detail: '저장하지 않으면 변경 내용이 사라집니다.',
  })
  if (response === 2) return
  if (response === 0) {
    const saved = await askRendererToSave(win)
    if (!saved) return
  }
  doc.closing = true
  win.close()
}

function askRendererToSave(win: BrowserWindow): Promise<boolean> {
  return new Promise((resolveSaved) => {
    const listener = (event: Electron.IpcMainEvent, ok: unknown) => {
      if (event.sender !== win.webContents) return
      ipcMain.removeListener(IPC.saveBeforeCloseReply, listener)
      resolveSaved(ok === true)
    }
    ipcMain.on(IPC.saveBeforeCloseReply, listener)
    win.webContents.send(IPC.saveBeforeClose)
  })
}

async function pickSavePath(win: BrowserWindow, doc: WindowDoc, kind: DocKind): Promise<string | null> {
  const ext = DEFAULT_EXTENSION[kind]
  const filters = {
    text: [{ name: '텍스트', extensions: ['txt'] }],
    markdown: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    html: [{ name: 'HTML', extensions: ['html', 'htm'] }],
  }[kind]
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: doc.path ?? untitledName(kind).replace(/\.[a-z]+$/, `.${ext}`),
    filters: [...filters, { name: '모든 파일', extensions: ['*'] }],
  })
  return canceled || !filePath ? null : filePath
}

async function writeDoc(
  win: BrowserWindow,
  doc: WindowDoc,
  path: string,
  content: string,
): Promise<SaveResult> {
  try {
    await writeFile(path, content, 'utf8')
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  doc.path = path
  doc.dirty = false
  // Save As into another known format: the renderer reloads onto that surface
  if (/\.(md|markdown|html?|txt)$/i.test(path)) doc.kind = docKindForPath(path)
  refreshTitle(win)
  app.addRecentDocument(path)
  return { ok: true, path }
}

async function openWithDialog(): Promise<void> {
  const focused = BrowserWindow.getFocusedWindow()
  const options: Electron.OpenDialogOptions = {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '지원 문서', extensions: ['md', 'markdown', 'html', 'htm', 'txt'] },
      { name: '모든 파일', extensions: ['*'] },
    ],
  }
  const { canceled, filePaths } = focused
    ? await dialog.showOpenDialog(focused, options)
    : await dialog.showOpenDialog(options)
  if (canceled) return
  for (const path of filePaths) openPath(path)
}

function openPath(path: string): void {
  // an untouched untitled window is reused instead of leaving an empty one behind
  const focused = BrowserWindow.getFocusedWindow()
  const doc = focused ? docs.get(focused.id) : undefined
  if (focused && doc && doc.path === null && !doc.dirty) {
    doc.path = path
    doc.kind = docKindForPath(path)
    refreshTitle(focused)
    focused.reload()
    app.addRecentDocument(path)
    return
  }
  createWindow(path)
}

function sendMenu(command: MenuCommand): void {
  BrowserWindow.getFocusedWindow()?.webContents.send(IPC.menuCommand, command)
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: '파일',
      submenu: [
        { label: '새 텍스트 문서', accelerator: 'CmdOrCtrl+N', click: () => createWindow(null, 'text') },
        { label: '새 Markdown 문서', accelerator: 'CmdOrCtrl+Shift+N', click: () => createWindow(null, 'markdown') },
        { label: '새 HTML 문서', accelerator: 'CmdOrCtrl+Alt+N', click: () => createWindow(null, 'html') },
        { type: 'separator' },
        { label: '열기…', accelerator: 'CmdOrCtrl+O', click: () => void openWithDialog() },
        { role: 'recentDocuments', submenu: [{ role: 'clearRecentDocuments' }] },
        { type: 'separator' },
        { label: '저장', accelerator: 'CmdOrCtrl+S', click: () => sendMenu('save') },
        { label: '다른 이름으로 저장…', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendMenu('saveAs') },
        { type: 'separator' },
        isMac ? { role: 'close', label: '창 닫기' } : { role: 'quit', label: '끝내기' },
      ],
    },
    {
      label: '편집',
      submenu: [
        { role: 'undo', label: '실행 취소' },
        { role: 'redo', label: '다시 실행' },
        { type: 'separator' },
        { role: 'cut', label: '잘라내기' },
        { role: 'copy', label: '복사' },
        { role: 'paste', label: '붙여넣기' },
        { role: 'pasteAndMatchStyle', label: '서식 없이 붙여넣기' },
        { role: 'selectAll', label: '모두 선택' },
        { type: 'separator' },
        { label: '찾기…', accelerator: 'CmdOrCtrl+F', click: () => sendMenu('find') },
      ],
    },
    {
      label: '보기',
      submenu: [
        { label: '소스 보기 전환', accelerator: 'CmdOrCtrl+/', click: () => sendMenu('toggleSource') },
        { label: '자동 줄 바꿈 전환', accelerator: 'Alt+Z', click: () => sendMenu('toggleWrap') },
        { type: 'separator' },
        { label: '확대', accelerator: 'CmdOrCtrl+=', click: () => sendMenu('zoomIn') },
        { label: '축소', accelerator: 'CmdOrCtrl+-', click: () => sendMenu('zoomOut') },
        { label: '원래 크기', accelerator: 'CmdOrCtrl+0', click: () => sendMenu('zoomReset') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '전체 화면' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' as const }, { role: 'reload' as const }]),
      ],
    },
    { role: 'windowMenu', label: '윈도우' },
    {
      role: 'help',
      label: '도움말',
      submenu: [
        { label: `${APP_NAME} 정보`, click: () => app.showAboutPanel() },
        {
          label: '웹사이트',
          click: () => void shell.openExternal('https://github.com/chojema/chojema-editor'),
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function registerIpc(): void {
  ipcMain.handle(IPC.getInitialDoc, async (event): Promise<InitialDoc> => {
    const found = docFor(event.sender)
    if (!found) return { path: null, kind: 'text', content: '' }
    const { doc } = found
    if (!doc.path) return { path: null, kind: doc.kind, content: '' }
    try {
      return { path: doc.path, kind: doc.kind, content: await readFile(doc.path, 'utf8') }
    } catch (error) {
      dialog.showErrorBox('파일을 열 수 없습니다', `${doc.path}\n\n${String(error)}`)
      doc.path = null
      refreshTitle(found.win)
      return { path: null, kind: doc.kind, content: '' }
    }
  })

  ipcMain.handle(IPC.save, async (event, content: string, kind: DocKind): Promise<SaveResult> => {
    const found = docFor(event.sender)
    if (!found) return { ok: false, error: 'no window' }
    const { win, doc } = found
    const path = doc.path ?? (await pickSavePath(win, doc, kind))
    if (!path) return { ok: false }
    return writeDoc(win, doc, path, content)
  })

  ipcMain.handle(IPC.saveAs, async (event, content: string, kind: DocKind): Promise<SaveResult> => {
    const found = docFor(event.sender)
    if (!found) return { ok: false, error: 'no window' }
    const { win, doc } = found
    const path = await pickSavePath(win, doc, kind)
    if (!path) return { ok: false }
    return writeDoc(win, doc, path, content)
  })

  ipcMain.on(IPC.setDirty, (event, dirty: boolean) => {
    const found = docFor(event.sender)
    if (!found || found.doc.dirty === dirty) return
    found.doc.dirty = dirty
    refreshTitle(found.win)
  })

  ipcMain.handle(IPC.saveImage, async (event, input: { base64: string; ext: string }) => {
    const found = docFor(event.sender)
    if (!found?.doc.path || !/^[a-z0-9]{1,5}$/i.test(input.ext)) return null
    const assets = join(dirname(found.doc.path), 'assets')
    await mkdir(assets, { recursive: true })
    const name = `image-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}.${input.ext}`
    await writeFile(join(assets, name), Buffer.from(input.base64, 'base64'))
    return `assets/${name}`
  })

  ipcMain.handle(IPC.pickImage, async (event) => {
    const found = docFor(event.sender)
    if (!found) return null
    const { canceled, filePaths } = await dialog.showOpenDialog(found.win, {
      properties: ['openFile'],
      filters: [{ name: '이미지', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }],
    })
    if (canceled || !filePaths[0]) return null
    const picked = filePaths[0]
    if (!found.doc.path) return picked
    const dir = dirname(found.doc.path)
    if (isInside(picked, dir)) return relative(dir, picked).split(sep).join('/')
    // an image outside the document folder is copied into assets/ so the file stays portable
    const assets = join(dir, 'assets')
    await mkdir(assets, { recursive: true })
    const target = join(assets, basename(picked))
    if (!existsSync(target)) await copyFile(picked, target)
    return `assets/${basename(picked)}`
  })

  ipcMain.handle(IPC.readAsset, async (event, relPath: string) => {
    const found = docFor(event.sender)
    if (!found?.doc.path || typeof relPath !== 'string') return null
    const dir = resolve(dirname(found.doc.path))
    const target = resolve(dir, relPath)
    if (!isInside(target, dir) || extname(target).toLowerCase() !== '.css') return null
    try {
      return await readFile(target, 'utf8')
    } catch {
      return null
    }
  })
}

function filesFromArgv(argv: string[]): string[] {
  return argv
    .slice(app.isPackaged ? 1 : 2)
    .filter((arg) => !arg.startsWith('-') && existsSync(arg))
    .map((arg) => resolve(arg))
}

const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    for (const path of filesFromArgv(argv)) openPath(path)
  })

  // macOS hands files over through this event, also before `ready`
  app.on('open-file', (event, path) => {
    event.preventDefault()
    if (app.isReady()) openPath(path)
    else pendingOpens.push(path)
  })

  void app.whenReady().then(() => {
    app.setName(APP_NAME)
    app.setAboutPanelOptions({
      applicationName: APP_NAME,
      applicationVersion: app.getVersion(),
      version: '',
      copyright: 'Copyright © 2026 chojema · Apache License 2.0',
      website: 'https://github.com/chojema/chojema-editor',
    })
    if (process.platform === 'darwin' && !app.isPackaged && existsSync(DEV_ICON)) {
      app.dock?.setIcon(DEV_ICON)
    }
    registerAssetProtocol()
    registerIpc()
    buildMenu()
    const initial = [...pendingOpens, ...filesFromArgv(process.argv)]
    if (initial.length === 0) createWindow(null, 'markdown')
    for (const path of initial) createWindow(path)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(null, 'markdown')
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
