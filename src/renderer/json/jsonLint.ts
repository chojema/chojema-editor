import { linter, lintGutter } from '@codemirror/lint'
import type { Extension } from '@codemirror/state'
import { t, type StringKey } from '../i18n/locale'
import { parseJson, type JsonErrorCode } from './jsonDoc'

const ERROR_TEXT: Record<JsonErrorCode, StringKey> = {
  empty: 'jsonErrEmpty',
  unexpected: 'jsonErrUnexpected',
  unexpectedEnd: 'jsonErrEnd',
  badString: 'jsonErrString',
  badNumber: 'jsonErrNumber',
  trailing: 'jsonErrTrailing',
  tooDeep: 'jsonErrDeep',
}

export const jsonErrorText = (code: JsonErrorCode) => t(ERROR_TEXT[code])

/** marks the first syntax error in a JSON source pane */
export function jsonLint(): Extension {
  return [
    lintGutter(),
    linter((view) => {
      const { error } = parseJson(view.state.doc.toString())
      if (!error) return []
      const from = Math.min(error.offset, view.state.doc.length)
      const to = Math.min(from + 1, view.state.doc.length)
      return [{ from, to, severity: 'error', message: jsonErrorText(error.code) }]
    }),
  ]
}
