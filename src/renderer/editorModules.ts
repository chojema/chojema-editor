import type { ComponentType, RefAttributes } from 'react'
import type { DocKind } from '../shared/ipc'
import type { SurfaceHandle, SurfaceProps } from './surface'
import { deferredModule } from './deferredModule'
import { loadLanguage } from './text/languages'

export type DeferredKind = Exclude<DocKind, 'text'>
export type SurfaceComponent = ComponentType<SurfaceProps & RefAttributes<SurfaceHandle>>

const surfaces = {
  markdown: deferredModule(async () => (await import('./markdown/MarkdownSurface')).MarkdownSurface),
  html: deferredModule(async () => (await import('./html/HtmlSurface')).HtmlSurface),
  json: deferredModule(async () => (await import('./json/JsonSurface')).JsonSurface),
  svg: deferredModule(async () => (await import('./svg/SvgSurface')).SvgSurface),
}

export async function loadSurface(kind: DeferredKind): Promise<SurfaceComponent> {
  // A requested document loads immediately, including its source grammar.
  const [Surface] = await Promise.all([surfaces[kind](), loadLanguage(kind)])
  return Surface
}

export const editorWarmups = (['markdown', 'html', 'json', 'svg'] as const)
  .map((kind) => () => loadSurface(kind))
