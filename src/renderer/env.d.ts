/// <reference types="vite/client" />
import type { EditorApi } from '../shared/ipc'

declare global {
  interface Window {
    editorApi: EditorApi
  }
}

export {}
