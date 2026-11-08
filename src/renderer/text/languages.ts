import type { Extension } from '@codemirror/state'
import { deferredModule } from '../deferredModule'

export type CodeLanguage = 'text' | 'markdown' | 'html' | 'json' | 'svg'
type LanguageFactory = () => Extension
const ready = new Map<CodeLanguage, LanguageFactory>()

const loaders = {
  markdown: deferredModule(async () => {
    const { markdown } = await import('@codemirror/lang-markdown')
    return () => markdown()
  }),
  html: deferredModule(async () => {
    const { html } = await import('@codemirror/lang-html')
    return () => html()
  }),
  json: deferredModule(async () => {
    const [{ json }, { jsonLint }] = await Promise.all([
      import('@codemirror/lang-json'), import('../json/jsonLint'),
    ])
    return () => [json(), jsonLint()]
  }),
}

/** A new factory result per editor keeps lint state local to its document. */
export function loadedLanguage(language: CodeLanguage): Extension {
  return ready.get(language)?.() ?? []
}

export async function loadLanguage(language: CodeLanguage): Promise<void> {
  if (language === 'text' || ready.has(language)) return
  const factory = await loaders[language === 'svg' ? 'html' : language]()
  ready.set(language, factory)
}
