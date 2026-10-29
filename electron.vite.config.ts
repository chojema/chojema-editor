import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

// every import must land on one copy of the TipTap core, or the bundle carries
// two schemas and extensions from one cannot see nodes from the other
const TIPTAP_DEDUPE = [
  '@tiptap/core',
  '@tiptap/pm',
  '@tiptap/react',
  '@tiptap/extensions',
  '@tiptap/extension-list',
  '@tiptap/extension-table',
  '@tiptap/extension-image',
  '@tiptap/suggestion',
  '@tiptap/markdown',
  '@tiptap/extension-highlight',
  '@tiptap/extension-code-block',
  '@tiptap/extension-text-style',
]

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    plugins: [react()],
    resolve: { dedupe: TIPTAP_DEDUPE },
  },
})
