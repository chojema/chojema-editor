import { describe, expect, it } from 'vitest'
import { markdownForWeb } from '../src/web/markdownExport'

describe('web Markdown export links', () => {
  it('keeps relative links as authored and encodes unsafe characters', () => {
    const markdown = markdownForWeb({
      markdown: '![a](P0) [b](P1) [c](P2)',
      links: [
        { placeholder: 'P0', url: 'assets/my image.png' },
        { placeholder: 'P1', url: '#intro' },
        { placeholder: 'P2', url: 'https://example.com/a(b)' },
      ],
      baseHref: null,
    })
    expect(markdown).toBe('![a](assets/my%20image.png) [b](#intro) [c](https://example.com/a%28b%29)')
  })

  it('applies an absolute base href', () => {
    const markdown = markdownForWeb({
      markdown: '[x](P0)',
      links: [{ placeholder: 'P0', url: 'docs/page.html' }],
      baseHref: 'https://example.com/site/',
    })
    expect(markdown).toBe('[x](https://example.com/site/docs/page.html)')
  })

  it('leaves links alone when the base href is relative', () => {
    const markdown = markdownForWeb({
      markdown: '[x](P0)',
      links: [{ placeholder: 'P0', url: 'page.html' }],
      baseHref: '../',
    })
    expect(markdown).toBe('[x](page.html)')
  })
})
