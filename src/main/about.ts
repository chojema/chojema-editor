import { BrowserWindow, shell } from 'electron'
import iconSvg from '../../build/icon.svg?raw'

export const REPOSITORY_URL = 'https://github.com/chojema/chojema-editor'
export const APP_PARK_URL = 'https://chojema.github.io/AppPark/'
/** The only destinations the About window may open, always in the external browser. */
export const ABOUT_LINKS = [REPOSITORY_URL, APP_PARK_URL] as const

export interface AboutInfo {
  name: string
  version: string
  language: 'ko' | 'en'
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

/** Static page: no scripts run in the About window; links are routed by the main process. */
export function aboutPageHtml({ name, version, language }: AboutInfo): string {
  const ko = language === 'ko'
  const link = (href: string, label: string) =>
    `<a href="${href}" target="_blank" rel="noopener noreferrer"><span class="label">${escapeHtml(label)}</span><span class="url">${escapeHtml(href.replace(/^https:\/\//, '').replace(/\/$/, ''))}</span></a>`
  return `<!doctype html>
<html lang="${language}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>${escapeHtml(ko ? `${name} 정보` : `About ${name}`)}</title>
<style>
:root { color-scheme: light dark; --bg: #f6f6f8; --text: #1d1d22; --muted: #6b6b76; --card: #ffffff; --border: #dcdce3; --accent: #4338ca; }
@media (prefers-color-scheme: dark) { :root { --bg: #1e1e22; --text: #ececf1; --muted: #a0a0ab; --card: #2a2a30; --border: #3b3b44; --accent: #a5a2ff; } }
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 24px 28px;
  background: var(--bg); color: var(--text); font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
  text-align: center; user-select: none; }
.icon svg { width: 84px; height: 84px; display: block; }
h1 { margin: 10px 0 0; font-size: 18px; font-weight: 650; }
.version, .copyright { margin: 0; color: var(--muted); }
.copyright { font-size: 11.5px; margin-top: 8px; }
nav { display: grid; gap: 8px; width: 100%; margin-top: 16px; }
a { display: grid; gap: 1px; padding: 9px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--card); color: var(--text); text-decoration: none; }
a:hover { border-color: var(--accent); }
a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.label { font-weight: 600; color: var(--accent); }
.url { font-size: 11.5px; color: var(--muted); }
</style></head><body>
<div class="icon" aria-hidden="true">${iconSvg.replace(/<\?xml[^>]*>/, '')}</div>
<h1>${escapeHtml(name)}</h1>
<p class="version">${escapeHtml(ko ? `버전 ${version}` : `Version ${version}`)}</p>
<nav aria-label="${ko ? '링크' : 'Links'}">
${link(REPOSITORY_URL, ko ? 'GitHub 저장소' : 'GitHub repository')}
${link(APP_PARK_URL, 'Chojema App Park')}
</nav>
<p class="copyright">Copyright © 2026 Chulwoo Park · Apache License 2.0</p>
</body></html>`
}

export function isAboutLink(url: string): boolean {
  return (ABOUT_LINKS as readonly string[]).includes(url)
}

let aboutWindow: BrowserWindow | null = null

function load(win: BrowserWindow, info: AboutInfo) {
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(aboutPageHtml(info))}`)
}

/** One About window per app; reopening focuses it and refreshes language/version. */
export function showAboutWindow(info: AboutInfo, icon?: string): void {
  if (aboutWindow && !aboutWindow.isDestroyed()) {
    load(aboutWindow, info)
    aboutWindow.show()
    aboutWindow.focus()
    return
  }
  const win = new BrowserWindow({
    width: 360,
    height: 400,
    useContentSize: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: info.language === 'ko' ? `${info.name} 정보` : `About ${info.name}`,
    autoHideMenuBar: true,
    ...(icon ? { icon } : {}),
    webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
  })
  aboutWindow = win
  win.removeMenu()
  const open = (url: string) => { if (isAboutLink(url)) void shell.openExternal(url) }
  win.webContents.setWindowOpenHandler(({ url }) => { open(url); return { action: 'deny' } })
  win.webContents.on('will-navigate', (event, url) => { event.preventDefault(); open(url) })
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') { event.preventDefault(); win.close() }
  })
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => { if (aboutWindow === win) aboutWindow = null })
  load(win, info)
}

/** Keep an open About window in the current UI language. */
export function refreshAboutWindow(info: AboutInfo): void {
  if (!aboutWindow || aboutWindow.isDestroyed()) return
  aboutWindow.setTitle(info.language === 'ko' ? `${info.name} 정보` : `About ${info.name}`)
  load(aboutWindow, info)
}
