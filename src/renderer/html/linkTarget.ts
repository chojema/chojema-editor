/** rel tokens that go with target="_blank" so the opened page cannot reach back to this one */
const NEW_WINDOW_REL = ['noopener', 'noreferrer']

export interface LinkTargetAttrs {
  target: string | null
  rel: string | null
}

/** whether the link opens in a new window or tab */
export function opensInNewWindow(target: unknown): boolean {
  return target === '_blank'
}

/**
 * target/rel for a link after the "open in new window" choice; other rel tokens
 * (nofollow, …) stay, and an unchanged choice leaves the attributes as written
 */
export function linkTargetAttrs(current: { target?: unknown; rel?: unknown }, newWindow: boolean): LinkTargetAttrs {
  const target = typeof current.target === 'string' && current.target ? current.target : null
  const rel = typeof current.rel === 'string' && current.rel.trim() ? current.rel.trim() : null
  if (opensInNewWindow(target) === newWindow) return { target, rel }
  const others = (rel ?? '').split(/\s+/).filter((token) => token && !NEW_WINDOW_REL.includes(token.toLowerCase()))
  const tokens = newWindow ? [...others, ...NEW_WINDOW_REL] : others
  return { target: newWindow ? '_blank' : null, rel: tokens.length ? tokens.join(' ') : null }
}
