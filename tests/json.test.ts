import { describe, expect, it } from 'vitest'
import { docKindForPath } from '../src/shared/ipc'
import {
  appendChild,
  convertLiteral,
  formatJson,
  isJsonNumber,
  lineColumn,
  lineNumberAt,
  lineOffsets,
  minifyJson,
  nodeAt,
  parseJson,
  remapPaths,
  removeChild,
  renameKey,
  setValue,
  sortJsonKeys,
  swapChildren,
  type JsonNode,
} from '../src/renderer/json/jsonDoc'

function rootOf(text: string): JsonNode {
  const { root, error } = parseJson(text)
  if (!root) throw new Error(`parse failed: ${error.code} at ${error.offset}`)
  return root
}

describe('parseJson', () => {
  it('accepts everything JSON.parse accepts in this corpus', () => {
    for (const text of ['{}', '[]', '0', '-0.5e+3', '"a\\u00e9\\n"', 'true', 'null', ' [1, {"a": [null]}]\n', '\ufeff{"a":1}']) {
      expect(parseJson(text).error, text).toBeNull()
    }
  })

  it('rejects what JSON.parse rejects and says where', () => {
    const cases: Array<[string, string, number]> = [
      ['', 'empty', 0],
      ['{"a":1,}', 'unexpected', 7],
      ['[1,]', 'unexpected', 3],
      ['{"a"}', 'unexpected', 4],
      ['[1', 'unexpectedEnd', 2],
      ['"abc', 'unexpectedEnd', 4],
      ['"a\nb"', 'badString', 2],
      ['"\\x"', 'badString', 1],
      ['01', 'badNumber', 0],
      ['1.', 'badNumber', 0],
      ['-', 'badNumber', 0],
      ['{} x', 'trailing', 3],
      ['// comment\n{}', 'unexpected', 0],
      ["{'a':1}", 'unexpected', 1],
      ['tru', 'unexpected', 0],
    ]
    for (const [text, code, offset] of cases) {
      expect(parseJson(text).error, text).toEqual({ code, offset })
      expect(() => JSON.parse(text), text).toThrow()
    }
  })

  it('reports pathological nesting instead of crashing', () => {
    const { error } = parseJson('['.repeat(2_000_000))
    expect(error?.code).toMatch(/tooDeep|unexpectedEnd/)
  })

  it('keeps duplicate keys and numeric-looking key order', () => {
    const root = rootOf('{"b":1,"2":2,"b":3}')
    expect(root.children.map((c) => c.key)).toEqual(['b', '2', 'b'])
  })

  it('gives line and column', () => {
    expect(lineColumn('{\n  x', 4)).toEqual({ line: 2, column: 3 })
    expect(lineColumn('ab', 0)).toEqual({ line: 1, column: 1 })
  })

  it('maps node offsets to source line numbers via lineOffsets/lineNumberAt', () => {
    const sample = '{\n  "a": 1,\r\n  "b": [\n    true,\n    false\n  ]\n}\n'
    const starts = lineOffsets(sample)
    const root = rootOf(sample)
    for (let offset = 0; offset <= sample.length; offset++) {
      expect(lineNumberAt(starts, offset)).toBe(lineColumn(sample, offset).line)
    }
    expect(lineNumberAt(starts, root.start)).toBe(1)
    expect(lineNumberAt(starts, root.children[0]!.start)).toBe(2)
    expect(lineNumberAt(starts, root.children[1]!.start)).toBe(3)
    expect(lineNumberAt(starts, root.children[1]!.value.children[0]!.start)).toBe(4)
    expect(lineNumberAt(starts, root.children[1]!.value.children[1]!.start)).toBe(5)
  })
})

describe('edits touch only what changed', () => {
  const doc = '{\n    "big": 12345678901234567890,  "f": 1.0,\n    "s": "\\u00e9",\n    "list": [1, 2]\n}\n'

  it('changes one value and leaves other spellings alone', () => {
    const root = rootOf(doc)
    const next = setValue(doc, root.children[1]!.value, '2')
    expect(next).toBe(doc.replace('1.0', '2'))
  })

  it('renames a key with escaping', () => {
    const root = rootOf(doc)
    expect(renameKey(doc, root.children[0]!, 'a"b')).toBe(doc.replace('"big"', '"a\\"b"'))
  })

  it('removes first, middle, last and only children and stays valid', () => {
    const text = '[\n  1,\n  2,\n  3\n]'
    const root = rootOf(text)
    expect(removeChild(text, root, 0)).toBe('[\n  2,\n  3\n]')
    expect(removeChild(text, root, 1)).toBe('[\n  1,\n  3\n]')
    expect(removeChild(text, root, 2)).toBe('[\n  1,\n  2\n]')
    expect(removeChild('[ 1 ]', rootOf('[ 1 ]'), 0)).toBe('[]')
    expect(removeChild('{"a":1,"b":2}', rootOf('{"a":1,"b":2}'), 1)).toBe('{"a":1}')
  })

  it('appends following the layout of the container', () => {
    const pretty = '{\n    "a": 1\n}'
    expect(appendChild(pretty, rootOf(pretty), 'b', '""')).toBe('{\n    "a": 1,\n    "b": ""\n}')
    const tight = '{"a":1}'
    expect(appendChild(tight, rootOf(tight), 'b', '2')).toBe('{"a":1,"b":2}')
    const inline = '[1, 2]'
    expect(appendChild(inline, rootOf(inline), null, '3')).toBe('[1, 2, 3]')
  })

  it('fills an empty container', () => {
    expect(appendChild('{}\n', rootOf('{}\n'), 'k', '""')).toBe('{\n  "k": ""\n}\n')
    const nested = '{\n\t"a": {}\n}'
    const a = rootOf(nested).children[0]!.value
    expect(appendChild(nested, a, 'k', '1')).toBe('{\n\t"a": {\n\t\t"k": 1\n\t}\n}')
    const oneLine = '{"a":[]}'
    expect(appendChild(oneLine, rootOf(oneLine).children[0]!.value, null, '1')).toBe('{"a":[1]}')
    const crlf = '{\r\n  "a": {}\r\n}'
    expect(appendChild(crlf, rootOf(crlf).children[0]!.value, 'k', '1')).toBe('{\r\n  "a": {\r\n    "k": 1\r\n  }\r\n}')
  })

  it('swaps neighbours with their keys', () => {
    const text = '{\n  "a": 1,\n  "b": [2]\n}'
    expect(swapChildren(text, rootOf(text), 0, 1)).toBe('{\n  "b": [2],\n  "a": 1\n}')
  })

  it('every edit result parses', () => {
    const root = rootOf(doc)
    for (const next of [
      appendChild(doc, root, 'n', 'null'),
      appendChild(doc, nodeAt(root, [3])!, null, '{}'),
      removeChild(doc, root, 3),
      swapChildren(doc, root, 2, 3),
    ]) {
      expect(parseJson(next).error).toBeNull()
    }
  })
})

describe('type conversion', () => {
  const convert = (literal: string, type: Parameters<typeof convertLiteral>[2]) =>
    convertLiteral(literal, rootOf(literal), type)

  it('carries a value over when it can', () => {
    expect(convert('12', 'string')).toBe('"12"')
    expect(convert('true', 'string')).toBe('"true"')
    expect(convert('" 12 "', 'number')).toBe('12')
    expect(convert('"false"', 'boolean')).toBe('false')
  })

  it('falls back to the default', () => {
    expect(convert('"abc"', 'number')).toBe('0')
    expect(convert('{"a":1}', 'array')).toBe('[]')
    expect(convert('1', 'null')).toBe('null')
  })

  it('validates number input', () => {
    for (const ok of ['0', '-1.5', '1e5', '123456789012345678901234']) expect(isJsonNumber(ok)).toBe(true)
    for (const bad of ['', '01', '1.', '+1', 'NaN', '0x10', '1 2']) expect(isJsonNumber(bad)).toBe(false)
  })
})

describe('whole-document rewrites', () => {
  it('formats with the document indent, keeping number and string spellings', () => {
    const text = '{"n":1.0,"big":12345678901234567890,"s":"\\u00e9","e":{},"l":[1,[]]}'
    expect(formatJson(text, rootOf(text))).toBe(
      '{\n  "n": 1.0,\n  "big": 12345678901234567890,\n  "s": "\\u00e9",\n  "e": {},\n  "l": [\n    1,\n    []\n  ]\n}',
    )
    const tabbed = '{\n\t"a": [1,2]\n}\n'
    expect(formatJson(tabbed, rootOf(tabbed))).toBe('{\n\t"a": [\n\t\t1,\n\t\t2\n\t]\n}\n')
  })

  it('minifies and keeps BOM, final line ending and CRLF style', () => {
    const text = '\ufeff{\r\n  "a": [ 1, 2 ]\r\n}\r\n'
    expect(minifyJson(text, rootOf(text))).toBe('\ufeff{"a":[1,2]}\r\n')
    expect(formatJson(text, rootOf(text))).toBe('\ufeff{\r\n  "a": [\r\n    1,\r\n    2\r\n  ]\r\n}\r\n')
  })

  it('sorts keys at every level but not array order', () => {
    const text = '{\n  "b": [{"z":1,"y":2}, 0],\n  "a": 1\n}'
    expect(sortJsonKeys(text, rootOf(text))).toBe(
      '{\n  "a": 1,\n  "b": [\n    {\n      "y": 2,\n      "z": 1\n    },\n    0\n  ]\n}',
    )
    expect(sortJsonKeys('{"b":1,"a":2}', rootOf('{"b":1,"a":2}'))).toBe('{"a":2,"b":1}')
  })

  it('round-trips semantics against JSON.parse', () => {
    const text = '{"a":[1,{"b":"c\\n"}],"d":null,"e":true,"f":-1.5e3}'
    expect(JSON.parse(formatJson(text, rootOf(text)))).toEqual(JSON.parse(text))
    expect(JSON.parse(minifyJson(text, rootOf(text)))).toEqual(JSON.parse(text))
  })
})

describe('remapPaths', () => {
  it('follows removal and keeps unrelated rows', () => {
    const keys = new Set(['', '0', '1', '1/0', '2', '2/3'])
    const removed = remapPaths(keys, [], (i) => (i === 1 ? null : i > 1 ? i - 1 : i))
    expect([...removed].sort()).toEqual(['', '0', '1', '1/3'])
  })

  it('follows a swap below a parent', () => {
    const swapped = remapPaths(new Set(['2/0/5', '2/1', '3/0']), [2], (i) => (i === 0 ? 1 : i === 1 ? 0 : i))
    expect([...swapped].sort()).toEqual(['2/0', '2/1/5', '3/0'])
  })
})

describe('docKindForPath', () => {
  it('opens .json on the JSON surface', () => {
    expect(docKindForPath('/a/b.JSON')).toBe('json')
    expect(docKindForPath('/a/b.jsonl')).toBe('text')
  })
})
