import type KatexModule from 'katex'

type Katex = typeof KatexModule

let katex: Katex | null = null
let loading: Promise<Katex> | null = null

/** KaTeX loads on the first formula, so documents without math never pay for it */
export function loadKatex(): Promise<Katex> {
  loading ??= import('katex').then(({ default: module }) => (katex = module))
  return loading
}

/** The KaTeX module when it is already loaded, else null */
export function loadedKatex(): Katex | null {
  return katex
}
