import type { Language } from '../shared/language'
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC, type EditorApi, type MenuCommand } from '../shared/ipc'

const api: EditorApi = {
  getInitialDoc: () => ipcRenderer.invoke(IPC.getInitialDoc),
  save: (content, kind) => ipcRenderer.invoke(IPC.save, content, kind),
  saveAs: (content, kind) => ipcRenderer.invoke(IPC.saveAs, content, kind),
  setDirty: (dirty) => ipcRenderer.send(IPC.setDirty, dirty),
  saveImage: (input) => ipcRenderer.invoke(IPC.saveImage, input),
  pickImage: () => ipcRenderer.invoke(IPC.pickImage),
  readAsset: (relPath) => ipcRenderer.invoke(IPC.readAsset, relPath),
  showKindMenu: () => ipcRenderer.send(IPC.kindMenu),
  openPaths: (paths) => ipcRenderer.send(IPC.openPaths, paths),
  pathForFile: (file) => webUtils.getPathForFile(file),
  exportMarkdown: (request) => ipcRenderer.invoke(IPC.exportMarkdown, request),
  exportHtml: (request) => ipcRenderer.invoke(IPC.exportHtml, request),
  exportPdf: (request) => ipcRenderer.invoke(IPC.exportPdf, request),
  print: (request) => ipcRenderer.invoke(IPC.print, request),
  copyRich: (html, text) => ipcRenderer.send(IPC.copyRich, html, text),
  setAutoCopy: (on) => ipcRenderer.send(IPC.setAutoCopy, on),
  onLanguageChanged(handler) {
    const listener = (_event: Electron.IpcRendererEvent, language: Language) => handler(language)
    ipcRenderer.on(IPC.languageChanged, listener)
    return () => ipcRenderer.removeListener(IPC.languageChanged, listener)
  },
  onAutoCompleteChanged(handler) {
    const listener = (_event: Electron.IpcRendererEvent, on: boolean) => handler(on)
    ipcRenderer.on(IPC.autoCompleteChanged, listener)
    return () => ipcRenderer.removeListener(IPC.autoCompleteChanged, listener)
  },
  onAutoCopyChanged(handler) {
    const listener = (_event: Electron.IpcRendererEvent, on: boolean) => handler(on)
    ipcRenderer.on(IPC.autoCopyChanged, listener)
    return () => ipcRenderer.removeListener(IPC.autoCopyChanged, listener)
  },
  onMenuCommand(handler) {
    const listener = (_event: Electron.IpcRendererEvent, command: MenuCommand) => handler(command)
    ipcRenderer.on(IPC.menuCommand, listener)
    return () => ipcRenderer.removeListener(IPC.menuCommand, listener)
  },
  onSaveBeforeClose(handler) {
    const listener = () => {
      void handler()
        .catch(() => false)
        .then((ok) => ipcRenderer.send(IPC.saveBeforeCloseReply, ok))
    }
    ipcRenderer.on(IPC.saveBeforeClose, listener)
    return () => ipcRenderer.removeListener(IPC.saveBeforeClose, listener)
  },
}

contextBridge.exposeInMainWorld('editorApi', api)
