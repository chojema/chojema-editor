import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type EditorApi, type MenuCommand } from '../shared/ipc'

const api: EditorApi = {
  getInitialDoc: () => ipcRenderer.invoke(IPC.getInitialDoc),
  save: (content, kind) => ipcRenderer.invoke(IPC.save, content, kind),
  saveAs: (content, kind) => ipcRenderer.invoke(IPC.saveAs, content, kind),
  setDirty: (dirty) => ipcRenderer.send(IPC.setDirty, dirty),
  saveImage: (input) => ipcRenderer.invoke(IPC.saveImage, input),
  pickImage: () => ipcRenderer.invoke(IPC.pickImage),
  readAsset: (relPath) => ipcRenderer.invoke(IPC.readAsset, relPath),
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
