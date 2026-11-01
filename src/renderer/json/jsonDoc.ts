/**
 * JSON text as a tree with source positions. The text stays the document: every
 * edit is a splice into it, so number spellings (1.0, 1e5, values beyond double
 * precision), string escapes, key order, duplicate keys and all formatting away
 * from the edit survive. JSON.parse would lose each of those.
 */

export type JsonType = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array'

export interface JsonNode {
  type: JsonType
  start: number
  end: number
  /** members of an object or items of an array */
  children: JsonChild[]
}

export interface JsonChild {
  /** decoded member name; null for an array item */
  key: string | null
  /** where the child begins: its key, or the value of an array item */
  start: number
  /** end of the quoted key; equals `start` for an array item */
  keyEnd: number
  value: JsonNode
}

export type JsonErrorCode = 'empty' | 'unexpected' | 'unexpectedEnd' | 'badString' | 'badNumber' | 'trailing' | 'tooDeep'

export interface JsonError {
  code: JsonErrorCode
  offset: number
}

export type JsonParse = { root: JsonNode; error: null } | { root: null; error: JsonError }

class ParseFailure extends Error {
  constructor(
    readonly code: JsonErrorCode,
    readonly offset: number,
  ) {
    super(code)
  }
}

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y
const ESCAPE = /\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4})/y
const LITERALS: Array<[string, JsonType]> = [
  ['true', 'boolean'],
  ['false', 'boolean'],
  ['null', 'null'],
]

export function parseJson(text: string): JsonParse {
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0

  const skipSpace = () => {
    for (;;) {
      const c = text.charCodeAt(pos)
      if (c !== 0x20 && c !== 0x0a && c !== 0x0d && c !== 0x09) return
      pos++
    }
  }
  const fail = (code: JsonErrorCode, offset = pos): never => {
    throw new ParseFailure(code, offset)
  }
  const unexpected = (): never => fail(pos >= text.length ? 'unexpectedEnd' : 'unexpected')

  const string = (): number => {
    const start = pos
    pos++
    for (;;) {
      if (pos >= text.length) fail('unexpectedEnd')
      const c = text.charCodeAt(pos)
      if (c === 0x22) return ++pos - start
      if (c < 0x20) fail('badString')
      if (c !== 0x5c) {
        pos++
        continue
      }
      ESCAPE.lastIndex = pos
      if (!ESCAPE.test(text)) fail('badString')
      pos = ESCAPE.lastIndex
    }
  }

  const value = (): JsonNode => {
    skipSpace()
    const start = pos
    const c = text[pos]
    if (c === '{' || c === '[') return container(c === '{')
    if (c === '"') {
      string()
      return { type: 'string', start, end: pos, children: [] }
    }
    if (c === '-' || (c !== undefined && c >= '0' && c <= '9')) {
      NUMBER.lastIndex = pos
      if (!NUMBER.test(text)) fail('badNumber')
      pos = NUMBER.lastIndex
      // "01" or "1.": the longest valid number stops short of more number text
      if (/[0-9.eE+-]/.test(text[pos] ?? '')) fail('badNumber', start)
      return { type: 'number', start, end: pos, children: [] }
    }
    for (const [word, type] of LITERALS) {
      if (text.startsWith(word, pos)) {
        pos += word.length
        return { type, start, end: pos, children: [] }
      }
    }
    return unexpected()
  }

  const container = (isObject: boolean): JsonNode => {
    const start = pos
    const close = isObject ? '}' : ']'
    const children: JsonChild[] = []
    pos++
    skipSpace()
    if (text[pos] === close) {
      pos++
      return { type: isObject ? 'object' : 'array', start, end: pos, children }
    }
    for (;;) {
      skipSpace()
      if (isObject) {
        const childStart = pos
        if (text[pos] !== '"') unexpected()
        string()
        const keyEnd = pos
        skipSpace()
        if (text[pos] !== ':') unexpected()
        pos++
        children.push({ key: JSON.parse(text.slice(childStart, keyEnd)) as string, start: childStart, keyEnd, value: value() })
      } else {
        const item = value()
        children.push({ key: null, start: item.start, keyEnd: item.start, value: item })
      }
      skipSpace()
      if (text[pos] === ',') {
        pos++
        continue
      }
      if (text[pos] === close) {
        pos++
        return { type: isObject ? 'object' : 'array', start, end: pos, children }
      }
      unexpected()
    }
  }

  try {
    skipSpace()
    if (pos >= text.length) return { root: null, error: { code: 'empty', offset: pos } }
    const root = value()
    skipSpace()
    if (pos < text.length) fail('trailing')
    return { root, error: null }
  } catch (error) {
    if (error instanceof ParseFailure) return { root: null, error: { code: error.code, offset: error.offset } }
    // nesting deep enough to exhaust the stack
    if (error instanceof RangeError) return { root: null, error: { code: 'tooDeep', offset: 0 } }
    throw error
  }
}

/** 1-based line and column of an offset */
export function lineColumn(text: string, offset: number): { line: number; column: number } {
  let line = 1
  let lineStart = 0
  for (let at = text.indexOf('\n'); at !== -1 && at < offset; at = text.indexOf('\n', at + 1)) {
    line++
    lineStart = at + 1
  }
  return { line, column: offset - lineStart + 1 }
}

/** start offset of every 1-based line (index 0 is line 1) */
export function lineOffsets(text: string): number[] {
  const starts = [0]
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) {
    starts.push(at + 1)
  }
  return starts
}

/** 1-based line number of a character offset, from a `lineOffsets` table */
export function lineNumberAt(starts: readonly number[], offset: number): number {
  let low = 0
  let high = starts.length - 1
  while (low <= high) {
    const mid = (low + high) >>> 1
    if (starts[mid]! <= offset) low = mid + 1
    else high = mid - 1
  }
  return Math.max(1, low)
}

function splice(text: string, from: number, to: number, insert: string): string {
  return text.slice(0, from) + insert + text.slice(to)
}

const eolOf = (text: string) => (text.includes('\r\n') ? '\r\n' : '\n')

/** the document's indent unit; two spaces when it has none */
function indentOf(text: string): string {
  return /[{[][ \t]*\r?\n([ \t]+)\S/.exec(text)?.[1] ?? '  '
}

/** a document already written on one line stays on one line */
function isOneLine(text: string): boolean {
  const body = text.trim()
  return body.length > 2 && !body.includes('\n')
}

function lineIndentAt(text: string, offset: number): string {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1
  return /^[ \t]*/.exec(text.slice(lineStart, offset))?.[0] ?? ''
}

export function setValue(text: string, node: JsonNode, literal: string): string {
  return splice(text, node.start, node.end, literal)
}

export function renameKey(text: string, child: JsonChild, key: string): string {
  return splice(text, child.start, child.keyEnd, JSON.stringify(key))
}

export function removeChild(text: string, parent: JsonNode, index: number): string {
  const { children } = parent
  const child = children[index]!
  if (children.length === 1) return splice(text, parent.start + 1, parent.end - 1, '')
  if (index < children.length - 1) return splice(text, child.start, children[index + 1]!.start, '')
  return splice(text, children[index - 1]!.value.end, child.value.end, '')
}

/** append to an object (`key` given) or an array (`key` null), following the parent's layout */
export function appendChild(text: string, parent: JsonNode, key: string | null, literal: string): string {
  const { children } = parent
  const first = children[0]
  const colon = first && first.key !== null ? text.slice(first.keyEnd, first.value.start) : isOneLine(text) ? ':' : ': '
  const entry = `${key === null ? '' : `${JSON.stringify(key)}${colon}`}${literal}`
  if (first) {
    const last = children[children.length - 1]!
    const before = children[children.length - 2]
    const separator = before ? text.slice(before.value.end, last.start) : `,${text.slice(parent.start + 1, first.start)}`
    return splice(text, last.value.end, last.value.end, `${separator}${entry}`)
  }
  if (isOneLine(text)) return splice(text, parent.start + 1, parent.end - 1, entry)
  const outer = lineIndentAt(text, parent.start)
  const eol = eolOf(text)
  return splice(text, parent.start + 1, parent.end - 1, `${eol}${outer}${indentOf(text)}${entry}${eol}${outer}`)
}

/** swap a child with its neighbour; the separator between them stays where it is */
export function swapChildren(text: string, parent: JsonNode, index: number, other: number): string {
  const a = parent.children[Math.min(index, other)]!
  const b = parent.children[Math.max(index, other)]!
  const aText = text.slice(a.start, a.value.end)
  const bText = text.slice(b.start, b.value.end)
  return text.slice(0, a.start) + bText + text.slice(a.value.end, b.start) + aText + text.slice(b.value.end)
}

export const DEFAULT_LITERAL: Record<JsonType, string> = {
  string: '""',
  number: '0',
  boolean: 'false',
  null: 'null',
  object: '{}',
  array: '[]',
}

export function isJsonNumber(input: string): boolean {
  return /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(input)
}

/** the literal a scalar becomes when its type changes, keeping the value when it carries over */
export function convertLiteral(text: string, node: JsonNode, type: JsonType): string {
  if (type === 'string' && (node.type === 'number' || node.type === 'boolean')) {
    return JSON.stringify(text.slice(node.start, node.end))
  }
  if (node.type === 'string') {
    const value = JSON.parse(text.slice(node.start, node.end)) as string
    if (type === 'number' && isJsonNumber(value.trim())) return value.trim()
    if (type === 'boolean' && (value === 'true' || value === 'false')) return value
  }
  return DEFAULT_LITERAL[type]
}

interface WriteOptions {
  indent: string
  eol: string
  sortKeys: boolean
}

function write(text: string, node: JsonNode, depth: number, options: WriteOptions): string {
  if (node.type !== 'object' && node.type !== 'array') return text.slice(node.start, node.end)
  const [open, close] = node.type === 'object' ? ['{', '}'] : ['[', ']']
  if (node.children.length === 0) return open + close
  const children =
    options.sortKeys && node.type === 'object'
      ? [...node.children].sort((a, b) => (a.key! < b.key! ? -1 : a.key! > b.key! ? 1 : 0))
      : node.children
  const pretty = options.indent !== ''
  const inner = pretty ? `${options.eol}${options.indent.repeat(depth + 1)}` : ''
  const entries = children.map((child) => {
    const value = write(text, child.value, depth + 1, options)
    if (child.key === null) return value
    return `${text.slice(child.start, child.keyEnd)}${pretty ? ': ' : ':'}${value}`
  })
  const outer = pretty ? `${options.eol}${options.indent.repeat(depth)}` : ''
  return `${open}${inner}${entries.join(`,${inner}`)}${outer}${close}`
}

/** rewrite the whole document, keeping a leading BOM and the final line ending */
function rewrite(text: string, root: JsonNode, indent: string, sortKeys: boolean): string {
  const eol = eolOf(text)
  const bom = text.charCodeAt(0) === 0xfeff ? '﻿' : ''
  const tail = /\r?\n[ \t\r\n]*$/.test(text) ? eol : ''
  return `${bom}${write(text, root, 0, { indent, eol, sortKeys })}${tail}`
}

export function formatJson(text: string, root: JsonNode): string {
  return rewrite(text, root, indentOf(text), false)
}

export function minifyJson(text: string, root: JsonNode): string {
  return rewrite(text, root, '', false)
}

/** sort object members by name at every level, keeping the document's layout style */
export function sortJsonKeys(text: string, root: JsonNode): string {
  return rewrite(text, root, isOneLine(text) ? '' : indentOf(text), true)
}

/** the node at a path of child indexes */
export function nodeAt(root: JsonNode, path: readonly number[]): JsonNode | null {
  let node: JsonNode | undefined = root
  for (const index of path) node = node?.children[index]?.value
  return node ?? null
}

export const pathKey = (path: readonly number[]) => path.join('/')

/**
 * Follow a change of sibling positions in a set of path keys (expanded rows):
 * `remap` gives a child's new index under `parent`, or null when it is gone.
 */
export function remapPaths(
  keys: ReadonlySet<string>,
  parent: readonly number[],
  remap: (index: number) => number | null,
): Set<string> {
  const out = new Set<string>()
  for (const key of keys) {
    const parts = key === '' ? [] : key.split('/').map(Number)
    const isUnder = parts.length > parent.length && parent.every((value, i) => parts[i] === value)
    if (!isUnder) {
      out.add(key)
      continue
    }
    const next = remap(parts[parent.length]!)
    if (next === null) continue
    parts[parent.length] = next
    out.add(pathKey(parts))
  }
  return out
}
