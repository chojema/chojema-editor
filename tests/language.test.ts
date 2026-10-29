import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { resolveLanguage } from '../src/shared/language'
import { setLanguage, t, useI18n } from '../src/renderer/i18n/locale'

afterEach(() => setLanguage('ko'))

describe('language preference', () => {
  it('honours explicit choices and falls back to English for other system languages', () => {
    expect(resolveLanguage('en', 'ko-KR')).toBe('en')
    expect(resolveLanguage('ko', 'en-US')).toBe('ko')
    expect(resolveLanguage('system', 'KO-kr')).toBe('ko')
    expect(resolveLanguage('system', 'ja-JP')).toBe('en')
    expect(resolveLanguage('system', '')).toBe('en')
  })

  it('updates mounted labels without replacing an uncontrolled editing field', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const { createElement } = await import('react')
    function View() {
      useI18n()
      return createElement('div', null, createElement('span', null, t('autoCopy')), createElement('input'))
    }
    try {
      await act(() => { setLanguage('ko'); root.render(createElement(View)) })
      const input = host.querySelector('input')!
      input.value = 'Unsaved text'
      expect(host.textContent).toContain('선택 시 복사')
      await act(() => setLanguage('en'))
      expect(host.textContent).toContain('Copy on select')
      expect(host.querySelector('input')).toBe(input)
      expect(input.value).toBe('Unsaved text')
      expect(document.documentElement.lang).toBe('en')
      await act(() => setLanguage('ko'))
      expect(host.textContent).toContain('선택 시 복사')
    } finally {
      await act(() => root.unmount())
      host.remove()
    }
  })
})
