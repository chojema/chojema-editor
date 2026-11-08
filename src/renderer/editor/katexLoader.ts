import type KatexModule from 'katex'
import { deferredModule } from '../deferredModule'

type Katex = typeof KatexModule

let katex: Katex | null = null
const load = deferredModule(async () => {
  const [{ default: module }] = await Promise.all([
    import('katex'), import('katex/dist/katex.min.css'),
  ])
  return (katex = module)
})

/** KaTeX loads on the first formula, so documents without math never pay for it */
export function loadKatex(): Promise<Katex> {
  return load()
}

/** The KaTeX module when it is already loaded, else null */
export function loadedKatex(): Katex | null {
  return katex
}
