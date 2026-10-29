import { describe, expect, it } from 'vitest'
import { htmlToMarkdown } from '../src/renderer/html/toMarkdown'
import { markdownForDestination } from '../src/main/markdownExport'

const convert = (html: string) => markdownForDestination(htmlToMarkdown(html), '/docs/page.html', '/docs/page.md')

describe('HTML to Markdown export', () => {
  it('converts headings, formatting, quotes, lists, links and images', () => {
    const md = convert('<h1>제목</h1><p><strong>굵게</strong> <em>기울임</em> <del>삭제</del></p><blockquote><p>인용</p></blockquote><ul><li>하나<ul><li>둘</li></ul></li></ul><p><a href="https://example.com/a">링크</a><img src="assets/a.png" alt="그림"></p>')
    expect(md).toContain('# 제목')
    expect(md).toContain('**굵게** *기울임* ~~삭제~~')
    expect(md).toContain('> 인용')
    expect(md).toMatch(/-\s+하나\n\s+-\s+둘/)
    expect(md).toContain('[링크](https://example.com/a)')
    expect(md).toContain('![그림](assets/a.png)')
  })
  it('excludes page metadata, CSS, executable code and embeds', () => {
    const md = convert('<html><head><title>Hidden title</title><style>body{color:red}</style></head><body><h2>Visible</h2><script>alert(1)</script><iframe src="x">frame</iframe><p>Text</p></body></html>')
    expect(md).toBe('## Visible\n\nText\n')
  })
  it('converts header and headerless tables without losing their first data row', () => {
    expect(convert('<table><tr><th>A</th><th>B</th></tr><tr><td>a|b</td><td>x<br>y</td></tr></table>')).toContain('| A | B |\n| --- | --- |\n| a\\|b | x  <br>y |')
    expect(convert('<table><tr><td>one</td><td>two</td></tr></table>')).toBe('|  |  |\n| --- | --- |\n| one | two |\n')
  })
  it('retains merged tables as HTML and removes scripts and event handlers from them', () => {
    const md = convert('<table onclick="evil()"><tr><th colspan="2">Heading</th></tr><tr><td>one</td><td>two<script>evil()</script></td></tr></table>')
    expect(md).toContain('<table>')
    expect(md).toContain('colspan="2"')
    expect(md).toContain('two')
    expect(md).not.toContain('evil')
  })
  it('uses fences longer than code contents and retains the language', () => {
    expect(convert('<pre><code class="language-js">const a = 1;\n```\n</code></pre>')).toBe('````js\nconst a = 1;\n```\n````\n')
    expect(convert('<pre>  plain\n    code</pre>')).toBe('```\n  plain\n    code\n```\n')
  })
  it('converts plain and editor-style task lists', () => {
    const md = convert('<ul><li><input type="checkbox" checked>Done</li><li data-type="taskItem" data-checked="false"><label><input type="checkbox"></label><div><p>Todo</p></div></li></ul>')
    expect(md).toMatch(/-\s+\[x\] Done/)
    expect(md).toMatch(/- +\[ \] Todo/)
  })
  it('keeps literal task-like text literal', () => {
    expect(convert('<ul><li>[x] literal</li></ul>')).toContain('\\[x\\] literal')
  })
  it('handles empty documents and escapes literal Markdown punctuation', () => {
    expect(convert('')).toBe('')
    expect(convert('<p>*literal* [brackets]</p>')).toContain('\\*literal\\* \\[brackets\\]')
  })
  it('removes unsafe destinations without removing link text', () => {
    const md = convert('<p><a href="java&#10;script:alert(1)">Keep text</a><img src="javascript:evil()"></p>')
    expect(md).toContain('Keep text')
    expect(md).not.toContain('javascript')
    expect(md).not.toContain('alert')
  })
})

describe('Markdown export asset references', () => {
  it('rebases references relative to the selected destination and escapes special characters', () => {
    const request = htmlToMarkdown('<p><a href="guide.html?q=1#intro">guide</a><img src="assets/a (1).png"><a href="#here">here</a></p>')
    const md = markdownForDestination(request, '/docs/page.html', '/exports/page.md')
    expect(md).toContain('../docs/guide.html?q=1#intro')
    expect(md).toContain('../docs/assets/a%20%281%29.png')
    expect(md).toContain('[here](#here)')
  })
  it('turns editor image URLs back into portable relative paths', () => {
    const md = markdownForDestination(htmlToMarkdown('<img src="md-asset:///docs/assets/a.png">'), '/docs/page.html', '/exports/page.md')
    expect(md).toContain('../docs/assets/a.png')
    expect(md).not.toContain('md-asset:')
  })
  it('honours relative and web base URLs', () => {
    const relative = htmlToMarkdown('<base href="assets/"><p><img src="x.png"></p>')
    expect(markdownForDestination(relative, '/docs/page.html', '/exports/page.md')).toContain('../docs/assets/x.png')
    const remote = htmlToMarkdown('<base href="https://example.com/posts/"><p><a href="../guide">go</a></p>')
    expect(markdownForDestination(remote, null, '/exports/page.md')).toContain('https://example.com/guide')
  })
  it('does not rewrite code or mix up more than ten link placeholders', () => {
    const request = htmlToMarkdown('<pre>assets/a.png</pre>' + Array.from({ length: 12 }, (_, i) => `<p><img src="assets/${i}.png"></p>`).join(''))
    const md = markdownForDestination(request, '/docs/page.html', '/exports/page.md')
    expect(md).toContain('```\nassets/a.png\n```')
    for (let i = 0; i < 12; i++) expect(md).toContain(`../docs/assets/${i}.png`)
    expect(md).not.toContain('export-link-')
  })
  it('preserves data images and unresolved links for untitled documents', () => {
    const md = markdownForDestination(htmlToMarkdown('<img src="data:image/png;base64,YQ=="><a href="guide.html">guide</a>'), null, '/exports/page.md')
    expect(md).toContain('data:image/png;base64,YQ==')
    expect(md).toContain('[guide](guide.html)')
  })
})
