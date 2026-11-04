import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { TIPTAP_DEDUPE } from './vite.shared'

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    plugins: [react()],
    resolve: { dedupe: TIPTAP_DEDUPE },
    // electron-vite leaves the renderer unminified by default; the 4 MB entry
    // chunk then has to be parsed and compiled on every window open
    build: { minify: true },
  },
})
