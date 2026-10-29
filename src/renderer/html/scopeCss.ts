/**
 * Confine a document's stylesheet to the editing canvas. The editor runs in
 * the same page as the app chrome, so a document rule like `body { … }` or
 * `p { … }` would otherwise restyle the toolbar too. Every selector is moved
 * under `scope`, and `html` / `body` / `:root` map onto the canvas itself.
 */

const ROOT_TOKEN = /^(?::root|html)(?=$|[\s>+~.#:[])/i
const BODY_TOKEN = /^body(?=$|[\s>+~.#:[])/i

function splitSelectors(text: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth--
    else if (ch === ',' && depth === 0) {
      out.push(text.slice(start, i))
      start = i + 1
    }
  }
  out.push(text.slice(start))
  return out
}

export function scopeSelector(selector: string, scope: string): string {
  let sel = selector.trim()
  if (!sel) return sel
  let anchored = false
  if (ROOT_TOKEN.test(sel)) {
    sel = sel.replace(ROOT_TOKEN, '').replace(/^\s*>?\s*/, '')
    anchored = true
    // `html body p`: the body is the same canvas
    if (BODY_TOKEN.test(sel)) sel = sel.replace(BODY_TOKEN, '')
  } else if (BODY_TOKEN.test(sel)) {
    sel = sel.replace(BODY_TOKEN, '')
    anchored = true
  }
  if (anchored) {
    // `body.dark p` keeps the compound on the canvas; `body p` becomes a descendant
    return /^[.#:[]/.test(sel) ? `${scope}${sel}` : `${scope}${sel ? ` ${sel.trim()}` : ''}`
  }
  return `${scope} ${sel}`
}

function rewriteRules(rules: CSSRuleList, scope: string): string {
  const out: string[] = []
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) {
      const selectors = splitSelectors(rule.selectorText).map((s) => scopeSelector(s, scope))
      out.push(`${selectors.join(', ')} { ${rule.style.cssText} }`)
    } else if (rule instanceof CSSMediaRule) {
      out.push(`@media ${rule.conditionText} { ${rewriteRules(rule.cssRules, scope)} }`)
    } else if (rule instanceof CSSSupportsRule) {
      out.push(`@supports ${rule.conditionText} { ${rewriteRules(rule.cssRules, scope)} }`)
    } else {
      // @font-face, @keyframes, @page, … are not tied to elements
      out.push(rule.cssText)
    }
  }
  return out.join('\n')
}

/** rewrite relative url(...) references against the stylesheet's own location */
function rebaseCssUrls(css: string, toUrl: (path: string) => string): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, quote: string, path: string) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(path)) return match
    return `url(${quote}${toUrl(path)}${quote})`
  })
}

export function scopeCss(css: string, scope: string, toUrl?: (path: string) => string): string {
  const sheet = new CSSStyleSheet()
  try {
    // @import is not allowed in a constructed sheet; drop it rather than fail the whole sheet
    sheet.replaceSync(css.replace(/@import[^;]+;/gi, ''))
  } catch {
    return ''
  }
  const scoped = rewriteRules(sheet.cssRules, scope)
  return toUrl ? rebaseCssUrls(scoped, toUrl) : scoped
}
