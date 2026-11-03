import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: class {}, shell: { openExternal: vi.fn() } }))
const { aboutPageHtml, isAboutLink, APP_PARK_URL, REPOSITORY_URL } = await import('../src/main/about')

describe('About window', () => {
  it('links the GitHub repository and Chojema App Park in both languages', () => {
    for (const language of ['ko', 'en'] as const) {
      const doc = new DOMParser().parseFromString(aboutPageHtml({ name: 'Chojema Editor', version: '1.2.3', language }), 'text/html')
      const links = Array.from(doc.querySelectorAll('a'), (a) => a.getAttribute('href'))
      expect(links).toEqual([REPOSITORY_URL, APP_PARK_URL])
      expect(doc.body.textContent).toContain('Chojema App Park')
      expect(doc.body.textContent).toContain('1.2.3')
      expect(doc.body.textContent).toContain(language === 'ko' ? 'GitHub 저장소' : 'GitHub repository')
      expect(doc.querySelector('script')).toBeNull()
      expect(doc.querySelector('svg')).not.toBeNull()
    }
    expect(APP_PARK_URL).toBe('https://chojema.github.io/AppPark/')
    expect(REPOSITORY_URL).toBe('https://github.com/chojema/chojema-editor')
  })

  it('opens only the two listed destinations', () => {
    expect(isAboutLink(REPOSITORY_URL)).toBe(true)
    expect(isAboutLink(APP_PARK_URL)).toBe(true)
    expect(isAboutLink('https://example.com/')).toBe(false)
    expect(isAboutLink('file:///etc/passwd')).toBe(false)
  })

  it('escapes the displayed name and version', () => {
    const html = aboutPageHtml({ name: '<b>x</b>', version: '"1"', language: 'en' })
    expect(html).not.toContain('<b>x</b>')
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
  })
})
