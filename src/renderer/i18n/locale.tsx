import { strings } from './strings'

export type Lang = keyof typeof strings
export type StringKey = keyof typeof strings.ko
export type Params = Record<string, string | number>
export type TFunc = (key: StringKey, params?: Params) => string

/** Korean UI unless the system prefers another language, then English */
const lang: Lang = (navigator.language || 'ko').toLowerCase().startsWith('ko') ? 'ko' : 'en'

export function t(key: StringKey, params?: Params): string {
  let text: string = strings[lang][key] ?? strings.en[key] ?? key
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.split(`{${name}}`).join(String(value))
    }
  }
  return text
}

/** hook-shaped access kept for the ported components; the language is fixed per window */
export function useI18n(): { lang: Lang; t: TFunc } {
  return { lang, t }
}
