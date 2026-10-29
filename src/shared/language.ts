export type LanguagePreference = 'system' | 'ko' | 'en'
export type Language = 'ko' | 'en'

export function resolveLanguage(preference: LanguagePreference, systemLocale: string): Language {
  if (preference === 'ko' || preference === 'en') return preference
  return systemLocale.toLowerCase().startsWith('ko') ? 'ko' : 'en'
}
