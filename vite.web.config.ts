import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { TIPTAP_DEDUPE } from './vite.shared'

/**
 * Browser build of the editor: the shared renderer with the web EditorApi in
 * place of the Electron preload. WEB_BASE is the path the site is served under
 * (GitHub Pages serves a project site at /<repo>/).
 */
export default defineConfig({
  root: resolve(__dirname, 'src/web'),
  base: process.env.WEB_BASE ?? './',
  plugins: [react()],
  resolve: { dedupe: TIPTAP_DEDUPE },
  build: {
    outDir: resolve(__dirname, 'out/web'),
    emptyOutDir: true,
  },
})
