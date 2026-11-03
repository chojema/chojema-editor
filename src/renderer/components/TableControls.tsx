import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../i18n/locale'
import type { TableAction } from '../tables/operations'
import type { TableTools } from '../tables/useTableTools'
import { IconTable } from './toolbar-icons'

export function tablePopoverPosition(x: number, y: number, width: number, height: number) {
  return { left: Math.max(8, Math.min(x, window.innerWidth - width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - height - 8)) }
}

export function TablePanel({ tools, onDone }: { tools: TableTools; onDone: () => void }) {
  const { t } = useI18n()
  const [amount, setAmount] = useState('1'), [width, setWidth] = useState('120')
  const target = tools.target
  if (!target) return null
  const rows = target.bottom - target.top, cols = target.right - target.left
  const count = Number(amount), valid = Number.isInteger(count) && count >= 1 && count <= 100
  const px = Number(width), validWidth = Number.isInteger(px) && px >= 1 && px <= 2000
  const action = (value: TableAction, label: string, quantity = 1, disabled = false) => (
    <button type="button" className={`table-action${value.startsWith('delete') ? ' danger' : ''}`} disabled={disabled || !tools.can(value)}
      onMouseDown={event => event.preventDefault()} onClick={() => { if (tools.run(value, quantity)) onDone() }}>{label}</button>
  )
  return <div className="table-action-panel">
    <strong>{t('tableSelected', { rows, cols })}</strong>
    <div className="table-action-pair">
      {action('selectRows', t('tableSelectRows'))}{action('selectColumns', t('tableSelectColumns'))}
    </div>
    <label className="table-field">{t('tableQuantity')}<input aria-label={t('tableQuantity')} type="number" min="1" max="100" value={amount} onChange={event => setAmount(event.target.value)} /></label>
    <div className="table-action-pair">
      {action('addRowBefore', t('tableRowAbove'), count, !valid)}{action('addRowAfter', t('tableRowBelow'), count, !valid)}
      {action('addColumnBefore', t('tableColLeft'), count, !valid)}{action('addColumnAfter', t('tableColRight'), count, !valid)}
    </div>
    <div className="table-action-pair">
      {action('deleteRow', t('tableDeleteRowsCount', { count: rows }))}{action('deleteColumn', t('tableDeleteColumnsCount', { count: cols }))}
    </div>
    {tools.kind === 'html' && <>
      <div className="table-action-pair">{action('mergeCells', t('tableMerge'))}{action('splitCell', t('tableSplit'))}</div>
      {action('toggleHeaderRow', t('tableToggleHeaderRow'))}
      <label className="table-field">{t('tableWidth')}<input aria-label={t('tableWidth')} type="number" min="1" max="2000" value={width} onChange={event => setWidth(event.target.value)} /></label>
      {action('setColumnWidth', t('tableApplyWidth'), px, !validWidth)}
    </>}
    {action('deleteTable', t('tableDeleteTable'))}
  </div>
}

export function TableButton({ tools }: { tools: TableTools }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false), [rows, setRows] = useState(3), [cols, setCols] = useState(3), [header, setHeader] = useState(true)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const button = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null)
  const label = t(tools.insideTable ? 'tableEdit' : 'insertTable')
  const close = () => setOpen(false)
  useEffect(() => {
    if (!open) return
    const locate = () => {
      const rect = button.current?.getBoundingClientRect(), pop = panel.current
      if (rect && pop) setPosition(tablePopoverPosition(rect.left, rect.bottom + 6, pop.offsetWidth, pop.offsetHeight))
    }
    locate()
    const outside = (event: MouseEvent) => { if (!panel.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) close() }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close(); button.current?.focus() } }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', escape)
    window.addEventListener('resize', locate)
    window.addEventListener('scroll', locate, true)
    panel.current?.querySelector<HTMLElement>('input,button:not(:disabled)')?.focus()
    return () => {
      document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape)
      window.removeEventListener('resize', locate); window.removeEventListener('scroll', locate, true)
    }
  }, [open, Boolean(tools.target)])
  const create = (r: number, c: number) => { if (tools.create(r, c, header)) close() }
  const valid = Number.isInteger(rows) && Number.isInteger(cols) && rows >= 1 && rows <= 100 && cols >= 1 && cols <= 30
  return <>
    <button ref={button} type="button" className={`tb-btn${tools.target ? ' is-active' : ''}`} title={label} aria-label={label}
      aria-haspopup="dialog" aria-expanded={open} disabled={!tools.editor} onMouseDown={event => event.preventDefault()}
      onClick={() => { tools.prepare(); setOpen(value => !value) }}><IconTable size={18} /></button>
    {open && createPortal(<div ref={panel} className="table-popover" role="dialog" aria-label={label} style={{ position: 'fixed', ...position }}>
      {tools.target ? <TablePanel tools={tools} onDone={close} /> : tools.insideTable ? <p>{t(tools.editor?.isActive('preservedHtmlTable') ? 'tableSourceOnly' : 'tableActionUnavailable')}</p> : <div className="table-create-panel">
        <strong>{t('tableCreate')}</strong>
        <div className="table-size-grid" role="group" aria-label={t('tableGrid')}>
          {Array.from({ length: 48 }, (_, index) => {
            const row = Math.floor(index / 8) + 1, col = index % 8 + 1
            return <button key={index} type="button" aria-label={t('tableSize', { rows: row, cols: col })}
              className={row <= rows && col <= cols ? 'chosen' : ''} tabIndex={row === Math.min(rows, 6) && col === Math.min(cols, 8) ? 0 : -1}
              onMouseEnter={() => { setRows(row); setCols(col) }}
              onKeyDown={event => {
                const r = Math.max(1, Math.min(6, row + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0)))
                const c = Math.max(1, Math.min(8, col + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0)))
                if (event.key.startsWith('Arrow')) { event.preventDefault(); setRows(r); setCols(c); (event.currentTarget.parentElement?.children[(r - 1) * 8 + c - 1] as HTMLElement)?.focus() }
              }} onClick={() => create(row, col)} />
          })}
        </div>
        <span aria-live="polite">{t('tableSize', { rows, cols })}</span>
        <form onSubmit={event => { event.preventDefault(); if (valid) create(rows, cols) }}>
          <label className="table-field">{t('tableRows')}<input aria-label={t('tableRows')} type="number" min="1" max="100" value={Number.isFinite(rows) ? rows : ''} onChange={event => setRows(event.target.valueAsNumber)} /></label>
          <label className="table-field">{t('tableColumns')}<input aria-label={t('tableColumns')} type="number" min="1" max="30" value={Number.isFinite(cols) ? cols : ''} onChange={event => setCols(event.target.valueAsNumber)} /></label>
          <label className="table-check"><input type="checkbox" checked={tools.kind === 'markdown' || header} disabled={tools.kind === 'markdown'} onChange={event => setHeader(event.target.checked)} />{t('tableHeader')}</label>
          <button className="table-action primary" type="submit" disabled={!valid}>{t('tableCreate')}</button>
        </form>
      </div>}
    </div>, document.body)}
  </>
}
