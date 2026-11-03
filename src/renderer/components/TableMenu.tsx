import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CellSelection, cellAround } from '@tiptap/pm/tables'
import { useI18n } from '../i18n/locale'
import type { TableTools } from '../tables/useTableTools'
import { TablePanel, tablePopoverPosition } from './TableControls'
import { IconColDelete, IconRowDelete } from './icons'

interface Props {
  tools: TableTools
  scrollRef: React.RefObject<HTMLElement | null>
  zoom: number
}

/** Cell-anchored quick actions plus the same named commands as the permanent toolbar. */
export function TableMenu({ tools, scrollRef, zoom }: Props) {
  const { t } = useI18n(), { editor, target, views } = tools
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null)
  const [popup, setPopup] = useState<{ top: number; left: number } | null>(null)
  const popRef = useRef<HTMLDivElement>(null), quickRef = useRef<HTMLDivElement>(null)
  const latest = useRef(tools); latest.current = tools

  useEffect(() => {
    if (!editor || !target || views.activePane !== 'visual' || views.mode === 'source') { setAnchor(null); return }
    let frame = 0
    const reposition = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const scroller = scrollRef.current
        if (!scroller) return
        const cell = editor.view.domAtPos(editor.state.selection.from).node
        const element = cell instanceof HTMLElement ? cell : cell.parentElement
        const td = element?.closest('td,th'), table = td?.closest('table')
        if (!td || !table) { setAnchor(null); return }
        const viewport = scroller.getBoundingClientRect(), bounds = table.getBoundingClientRect()
        if (bounds.bottom < viewport.top || bounds.top > viewport.bottom) { setAnchor(null); return }
        const width = quickRef.current?.offsetWidth ?? 200, height = quickRef.current?.offsetHeight ?? 36
        // Dock outside the table so the bar never covers cells the user may click next;
        // only a table taller than the viewport falls back to pinning at the top edge.
        const above = bounds.top - height - 5, below = bounds.bottom + 5
        const top = above >= viewport.top + 6 ? above : below + height <= viewport.bottom - 6 ? below : viewport.top + 6
        const position = tablePopoverPosition(Math.max(bounds.left, bounds.right - width), top, width, height)
        position.top = Math.max(viewport.top + 6, Math.min(position.top, viewport.bottom - height - 6))
        setAnchor(previous => previous?.top === position.top && previous.left === position.left ? previous : position)
      })
    }
    setAnchor({ top: -1000, left: 8 })
    reposition()
    editor.on('selectionUpdate', reposition); editor.on('update', reposition)
    const scroller = scrollRef.current
    scroller?.addEventListener('scroll', reposition, { capture: true, passive: true })
    window.addEventListener('resize', reposition)
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(reposition) : null
    if (scroller) observer?.observe(scroller)
    return () => {
      cancelAnimationFrame(frame); observer?.disconnect()
      editor.off('selectionUpdate', reposition); editor.off('update', reposition)
      scroller?.removeEventListener('scroll', reposition, true); window.removeEventListener('resize', reposition)
    }
  }, [editor, Boolean(target), views.activePane, views.mode, scrollRef, zoom])

  useEffect(() => {
    if (!editor) return
    const surface = editor.view.dom.closest('.surface')
    if (!surface) return
    const context = (event: Event) => {
      const mouse = event as MouseEvent, current = latest.current
      const element = mouse.target as HTMLElement
      if (element.closest('.cm-content')) {
        current.views.sourceRef.current?.selectAtCoords(mouse.clientX, mouse.clientY)
        current.views.activate('source')
        if (!current.prepare()) return
      } else {
        const cell = element.closest('td,th')
        if (!cell || !editor.view.dom.contains(cell)) return
        current.views.activate('visual')
        const pos = editor.view.posAtDOM(cell, 0)
        const $cell = cellAround(editor.state.doc.resolve(pos))
        if (!$cell) return
        const selection = editor.state.selection
        const selected = selection instanceof CellSelection && selection.ranges.some(range => pos >= range.$from.pos && pos <= range.$to.pos)
        if (!selected) editor.commands.setCellSelection({ anchorCell: $cell.pos })
        current.prepare()
      }
      if (!editor.isActive('table')) return
      mouse.preventDefault()
      current.refresh()
      setPopup(tablePopoverPosition(mouse.clientX, mouse.clientY, 300, current.kind === 'html' ? 540 : 330))
    }
    const keyboard = (event: Event) => {
      const key = event as KeyboardEvent
      if (!(key.key === 'ContextMenu' || key.shiftKey && key.key === 'F10')) return
      latest.current.prepare()
      if (!editor.isActive('table')) return
      key.preventDefault()
      const rect = surface.getBoundingClientRect()
      setPopup(tablePopoverPosition(rect.left + 30, rect.top + 80, 300, latest.current.kind === 'html' ? 540 : 330))
    }
    surface.addEventListener('contextmenu', context); surface.addEventListener('keydown', keyboard)
    return () => { surface.removeEventListener('contextmenu', context); surface.removeEventListener('keydown', keyboard) }
  }, [editor])

  useEffect(() => {
    if (!popup) return
    const element = popRef.current
    if (element) setPopup(position => position && tablePopoverPosition(position.left, position.top, element.offsetWidth, element.offsetHeight))
    element?.querySelector<HTMLElement>('button:not(:disabled),input')?.focus()
    const outside = (event: MouseEvent) => { if (!popRef.current?.contains(event.target as Node)) setPopup(null) }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault(); setPopup(null)
      if (latest.current.views.lastPaneRef.current === 'source') latest.current.views.sourceRef.current?.focus()
      else editor?.commands.focus()
    }
    document.addEventListener('mousedown', outside); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape) }
  }, [Boolean(popup), editor])

  const rows = target ? target.bottom - target.top : 0, cols = target ? target.right - target.left : 0
  return <>
    {anchor && target && createPortal(<div ref={quickRef} className="table-menu" role="toolbar" aria-label={t('tableEdit')} style={{ position: 'fixed', ...anchor }}>
      <button className="table-quick-label" onMouseDown={event => event.preventDefault()} onClick={() => { tools.prepare(); setPopup(tablePopoverPosition(anchor.left, anchor.top + 38, 300, tools.kind === 'html' ? 540 : 330)) }}>{t('tableEdit')}</button>
      <span className="table-selection-size">{rows} × {cols}</span>
      <button type="button" className="tm-btn danger" title={t('tableDeleteRowsCount', { count: rows })} aria-label={t('tableDeleteRowsCount', { count: rows })} disabled={!tools.can('deleteRow')} onMouseDown={event => event.preventDefault()} onClick={() => tools.run('deleteRow')}><IconRowDelete size={15} /></button>
      <button type="button" className="tm-btn danger" title={t('tableDeleteColumnsCount', { count: cols })} aria-label={t('tableDeleteColumnsCount', { count: cols })} disabled={!tools.can('deleteColumn')} onMouseDown={event => event.preventDefault()} onClick={() => tools.run('deleteColumn')}><IconColDelete size={15} /></button>
    </div>, document.body)}
    {popup && target && createPortal(<div ref={popRef} className="table-popover" role="dialog" aria-label={t('tableEdit')} style={{ position: 'fixed', ...popup }}><TablePanel tools={tools} onDone={() => setPopup(null)} /></div>, document.body)}
  </>
}
