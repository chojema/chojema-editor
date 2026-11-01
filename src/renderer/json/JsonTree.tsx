import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { t, type StringKey } from '../i18n/locale'
import {
  appendChild,
  convertLiteral,
  DEFAULT_LITERAL,
  isJsonNumber,
  lineNumberAt,
  lineOffsets,
  pathKey,
  removeChild,
  renameKey,
  setValue,
  swapChildren,
  type JsonNode,
  type JsonType,
} from './jsonDoc'

/** a long array shows this many rows at a time, so a large file stays responsive */
const PAGE = 200
const START_DEPTH = 2

const TYPES: Array<{ type: JsonType; label: StringKey }> = [
  { type: 'string', label: 'jsonTypeString' },
  { type: 'number', label: 'jsonTypeNumber' },
  { type: 'boolean', label: 'jsonTypeBoolean' },
  { type: 'null', label: 'jsonTypeNull' },
  { type: 'object', label: 'jsonTypeObject' },
  { type: 'array', label: 'jsonTypeArray' },
]

type Path = readonly number[]

export type ExpandedChange = (change: (keys: Set<string>) => Set<string>) => void

/** paths of the containers a document opens with, down to `depth` (all when omitted) */
export function expandablePaths(root: JsonNode, depth = Infinity): Set<string> {
  const keys = new Set<string>()
  const walk = (node: JsonNode, path: number[]) => {
    if (node.children.length === 0 || path.length >= depth) return
    keys.add(pathKey(path))
    node.children.forEach((child, i) => walk(child.value, [...path, i]))
  }
  walk(root, [])
  return keys
}

export const initialExpanded = (root: JsonNode | null) => (root ? expandablePaths(root, START_DEPTH) : new Set<string>())

export interface JsonMatch {
  path: number[]
}

/** rows whose name or scalar value contains the query */
export function findMatches(text: string, root: JsonNode, query: string): JsonMatch[] {
  const needle = query.toLowerCase()
  const matches: JsonMatch[] = []
  if (!needle) return matches
  const shown = (node: JsonNode) => {
    const raw = text.slice(node.start, node.end)
    return node.type === 'string' ? (JSON.parse(raw) as string) : raw
  }
  const walk = (node: JsonNode, path: number[], key: string | null) => {
    const scalar = node.type !== 'object' && node.type !== 'array'
    if (key?.toLowerCase().includes(needle) || (scalar && shown(node).toLowerCase().includes(needle))) {
      matches.push({ path })
    }
    node.children.forEach((child, i) => walk(child.value, [...path, i], child.key))
  }
  walk(root, [], null)
  return matches
}

type Editing = { path: string; field: 'key' | 'value' }

interface TreeProps {
  text: string
  root: JsonNode
  /** the tree is a stale copy of a source that does not parse */
  readOnly: boolean
  expanded: ReadonlySet<string>
  onExpanded: ExpandedChange
  onEdit: (next: string) => void
  /** an edit that shifts siblings: the rows that stay expanded must shift too */
  onShift: (parent: Path, remap: (index: number) => number | null) => void
  matchPaths: ReadonlySet<string>
  currentMatch: Path | null
}

export function JsonTree({ text, root, readOnly, expanded, onExpanded, onEdit, onShift, matchPaths, currentMatch }: TreeProps) {
  const [editing, setEditing] = useState<Editing | null>(null)
  const [limits, setLimits] = useState<ReadonlyMap<string, number>>(new Map())
  const hostRef = useRef<HTMLDivElement>(null)
  const focusAfter = useRef<string | null>(null)
  const lines = useMemo(() => lineOffsets(text), [text])
  const gutterDigits = Math.max(3, String(lines.length).length)

  useLayoutEffect(() => {
    if (focusAfter.current === null) return
    hostRef.current?.querySelector<HTMLElement>(`[data-path="${focusAfter.current}"]`)?.focus({ preventScroll: false })
    focusAfter.current = null
  })

  // the current match may sit past the rows a long array shows
  const matchKey = currentMatch ? pathKey(currentMatch) : null
  useEffect(() => {
    if (!currentMatch) return
    setLimits((old) => {
      let next: Map<string, number> | null = null
      currentMatch.forEach((index, depth) => {
        const key = pathKey(currentMatch.slice(0, depth))
        if (index >= (old.get(key) ?? PAGE)) (next ??= new Map(old)).set(key, (Math.floor(index / PAGE) + 1) * PAGE)
      })
      return next ?? old
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchKey])
  useEffect(() => {
    if (matchKey === null) return
    hostRef.current?.querySelector(`[data-path="${matchKey}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [matchKey, limits, expanded])

  const toggle = (key: string, open: boolean) =>
    onExpanded((keys) => {
      const next = new Set(keys)
      if (open) next.add(key)
      else next.delete(key)
      return next
    })

  const add = (node: JsonNode, path: Path) => {
    const key = pathKey(path)
    const index = node.children.length
    const childKey = pathKey([...path, index])
    if (node.type === 'object') {
      const taken = new Set(node.children.map((child) => child.key))
      let name = 'key'
      for (let n = 2; taken.has(name); n++) name = `key${n}`
      onEdit(appendChild(text, node, name, DEFAULT_LITERAL.string))
      setEditing({ path: childKey, field: 'key' })
    } else {
      onEdit(appendChild(text, node, null, DEFAULT_LITERAL.string))
      setEditing({ path: childKey, field: 'value' })
    }
    toggle(key, true)
    setLimits((old) => {
      if (index < (old.get(key) ?? PAGE)) return old
      return new Map(old).set(key, index + 1)
    })
  }

  const row = (node: JsonNode, path: Path, parent: JsonNode | null, index: number): React.ReactNode => {
    const key = pathKey(path)
    const child = parent?.children[index]
    const isContainer = node.type === 'object' || node.type === 'array'
    const open = isContainer && node.children.length > 0 && expanded.has(key)
    const limit = limits.get(key) ?? PAGE
    const isEditingKey = editing?.path === key && editing.field === 'key'
    const isEditingValue = editing?.path === key && editing.field === 'value'
    const isCurrent = matchKey === key
    const finish = () => {
      setEditing(null)
      focusAfter.current = key
    }
    const siblings = parent?.children.length ?? 0

    const move = (other: number) => {
      onEdit(swapChildren(text, parent!, index, other))
      onShift(path.slice(0, -1), (i) => (i === index ? other : i === other ? index : i))
      focusAfter.current = pathKey([...path.slice(0, -1), other])
    }
    const remove = () => {
      onEdit(removeChild(text, parent!, index))
      onShift(path.slice(0, -1), (i) => (i === index ? null : i > index ? i - 1 : i))
      const focusIndex = Math.min(index, siblings - 2)
      focusAfter.current = pathKey(focusIndex >= 0 ? [...path.slice(0, -1), focusIndex] : path.slice(0, -1))
    }
    const changeType = (type: JsonType) => {
      if (type === node.type) return
      onEdit(setValue(text, node, convertLiteral(text, node, type)))
      focusAfter.current = key
    }

    const onRowKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return
      const rows = Array.from(hostRef.current?.querySelectorAll<HTMLElement>('.json-row') ?? [])
      const at = rows.indexOf(event.currentTarget)
      const go = (target: HTMLElement | undefined) => {
        event.preventDefault()
        target?.focus()
      }
      if (event.key === 'ArrowDown') go(rows[at + 1])
      else if (event.key === 'ArrowUp') go(rows[at - 1])
      else if (event.key === 'ArrowRight' && isContainer) {
        event.preventDefault()
        toggle(key, true)
      } else if (event.key === 'ArrowLeft' && isContainer && open) {
        event.preventDefault()
        toggle(key, false)
      } else if (readOnly) return
      else if (event.key === 'Enter' && !isContainer && node.type !== 'null') {
        event.preventDefault()
        if (node.type === 'boolean') changeBoolean()
        else setEditing({ path: key, field: 'value' })
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && parent) {
        event.preventDefault()
        remove()
      }
    }
    const changeBoolean = () => {
      onEdit(setValue(text, node, text.slice(node.start, node.end) === 'true' ? 'false' : 'true'))
      focusAfter.current = key
    }

    const line = lineNumberAt(lines, child ? child.start : node.start)
    const indent = path.length * 18 + 6

    return (
      <div key={key} role="treeitem" aria-expanded={isContainer && node.children.length > 0 ? open : undefined}>
        <div
          className={`json-row${matchPaths.has(key) ? ' is-match' : ''}${isCurrent ? ' is-current' : ''}`}
          data-path={key}
          tabIndex={0}
          onKeyDown={onRowKey}
        >
          <span className="json-line" aria-hidden>
            {line}
          </span>
          {isContainer && node.children.length > 0 ? (
            <button
              type="button"
              className="json-toggle"
              style={{ marginLeft: indent }}
              tabIndex={-1}
              aria-label={t(open ? 'jsonCollapse' : 'jsonExpand')}
              onClick={() => toggle(key, !open)}
            >
              {open ? '▾' : '▸'}
            </button>
          ) : (
            <span className="json-toggle" style={{ marginLeft: indent }} />
          )}
          {child?.key != null &&
            (isEditingKey ? (
              <InlineInput
                className="json-key-input"
                initial={child.key}
                label={t('jsonKeyLabel')}
                validate={(name) => name === child.key || !parent!.children.some((c) => c.key === name)}
                onCommit={(name) => {
                  if (name !== child.key) onEdit(renameKey(text, child, name))
                  finish()
                }}
                onCancel={finish}
              />
            ) : (
              <button
                type="button"
                className="json-key"
                tabIndex={-1}
                disabled={readOnly}
                title={t('jsonEditKey')}
                onClick={() => setEditing({ path: key, field: 'key' })}
              >
                {child.key}
              </button>
            ))}
          {child && child.key === null && <span className="json-index">{index}</span>}
          {child && <span className="json-colon">:</span>}
          {isEditingValue ? (
            <InlineInput
              className="json-value-input"
              initial={node.type === 'string' ? (JSON.parse(text.slice(node.start, node.end)) as string) : text.slice(node.start, node.end)}
              label={t('jsonValueLabel')}
              validate={(input) => node.type === 'string' || isJsonNumber(input.trim())}
              onCommit={(input) => {
                const literal = node.type === 'string' ? JSON.stringify(input) : input.trim()
                const unchanged =
                  node.type === 'string'
                    ? input === JSON.parse(text.slice(node.start, node.end))
                    : literal === text.slice(node.start, node.end)
                if (!unchanged) onEdit(setValue(text, node, literal))
                finish()
              }}
              onCancel={finish}
            />
          ) : (
            <ValueView
              text={text}
              node={node}
              open={open}
              readOnly={readOnly}
              onEdit={() => {
                if (node.type === 'boolean') changeBoolean()
                else setEditing({ path: key, field: 'value' })
              }}
            />
          )}
          {!readOnly && (
            <span className="json-actions">
              <select
                className="json-type"
                aria-label={t('jsonTypeLabel')}
                title={t('jsonTypeLabel')}
                tabIndex={-1}
                value={node.type}
                onChange={(event) => changeType(event.target.value as JsonType)}
              >
                {TYPES.map((option) => (
                  <option key={option.type} value={option.type}>
                    {t(option.label)}
                  </option>
                ))}
              </select>
              {isContainer && (
                <RowButton label={t('jsonAddChild')} onClick={() => add(node, path)}>
                  +
                </RowButton>
              )}
              {parent && (
                <>
                  <RowButton label={t('jsonMoveUp')} disabled={index === 0} onClick={() => move(index - 1)}>
                    ↑
                  </RowButton>
                  <RowButton label={t('jsonMoveDown')} disabled={index === siblings - 1} onClick={() => move(index + 1)}>
                    ↓
                  </RowButton>
                  <RowButton label={t('jsonRemove')} onClick={remove}>
                    ×
                  </RowButton>
                </>
              )}
            </span>
          )}
        </div>
        {open && (
          <div role="group">
            {node.children.slice(0, limit).map((c, i) => row(c.value, [...path, i], node, i))}
            {node.children.length > limit && (
              <div className="json-more-row">
                <span className="json-line" aria-hidden />
                <button
                  type="button"
                  className="json-more"
                  style={{ marginLeft: (path.length + 1) * 18 + 6 }}
                  onClick={() => setLimits((old) => new Map(old).set(key, limit + PAGE))}
                >
                  {t('jsonShowMore', { n: (node.children.length - limit).toLocaleString() })}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className={`json-tree${readOnly ? ' is-stale' : ''}`}
      role="tree"
      ref={hostRef}
      style={{ '--json-gutter-digits': gutterDigits } as React.CSSProperties}
    >
      {row(root, [], null, 0)}
    </div>
  )
}

function RowButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button type="button" className="json-action" tabIndex={-1} title={label} aria-label={label} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  )
}

function ValueView({
  text,
  node,
  open,
  readOnly,
  onEdit,
}: {
  text: string
  node: JsonNode
  open: boolean
  readOnly: boolean
  onEdit: () => void
}) {
  if (node.type === 'object' || node.type === 'array') {
    const [left, right] = node.type === 'object' ? ['{', '}'] : ['[', ']']
    if (open) return <span className="json-brace">{left}</span>
    const count = node.children.length
    return (
      <span className="json-brace">
        {left}
        {count > 0 && <span className="json-count"> {t(node.type === 'object' ? 'jsonCountKeys' : 'jsonCountItems', { n: count.toLocaleString() })} </span>}
        {right}
      </span>
    )
  }
  const raw = text.slice(node.start, node.end)
  if (node.type === 'null') return <span className="json-val json-val-null">null</span>
  const shown = node.type === 'string' ? (JSON.parse(raw) as string) : raw
  return (
    <button type="button" className={`json-val json-val-${node.type}`} tabIndex={-1} disabled={readOnly} onClick={onEdit}>
      {shown === '' ? <span className="json-empty">{t('jsonEmptyString')}</span> : shown}
    </button>
  )
}

/** one field being edited; Enter commits, Shift+Enter breaks a line, Esc cancels, leaving commits */
function InlineInput({
  className,
  initial,
  label,
  validate,
  onCommit,
  onCancel,
}: {
  className: string
  initial: string
  label: string
  validate: (value: string) => boolean
  onCommit: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLTextAreaElement>(null)
  const done = useRef(false)
  const valid = validate(value)

  useLayoutEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const commit = () => {
    if (done.current) return
    done.current = true
    onCommit(value)
  }
  const cancel = () => {
    if (done.current) return
    done.current = true
    onCancel()
  }

  return (
    <textarea
      ref={ref}
      className={`json-input ${className}${valid ? '' : ' is-invalid'}`}
      aria-label={label}
      aria-invalid={!valid}
      rows={Math.max(1, value.split('\n').length)}
      spellCheck={false}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Escape') {
          event.preventDefault()
          cancel()
        } else if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          if (valid) commit()
        }
      }}
      // an invalid field cannot be written, so leaving it keeps the old value
      onBlur={() => (valid ? commit() : cancel())}
    />
  )
}
