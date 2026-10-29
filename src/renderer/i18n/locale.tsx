import { useSyncExternalStore } from 'react'
import { strings } from './strings'

export type Lang = keyof typeof strings
export type StringKey = keyof typeof strings.ko
export type Params = Record<string, string | number>
export type TFunc = (key: StringKey, params?: Params) => string

/** Korean UI unless the system prefers another language, then English */
let lang: Lang = (navigator.language || 'ko').toLowerCase().startsWith('ko') ? 'ko' : 'en'

const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function setLanguage(language: Lang): void {
  document.documentElement.lang = language
  if (lang === language) return
  lang = language
  for (const listener of listeners) listener()
}

export function t(key: StringKey, params?: Params): string {
  let text: string = strings[lang][key] ?? strings.en[key] ?? key
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.split(`{${name}}`).join(String(value))
    }
  }
  return text
}

/** Subscribe without remounting the editor or losing its undo history. */
export function useI18n(): { lang: Lang; t: TFunc } {
  const language = useSyncExternalStore(subscribe, () => lang)
  return { lang: language, t }
}
