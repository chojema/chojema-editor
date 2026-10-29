import { HighlightStyle } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

/**
 * Syntax colours for the source panes. Colours are CSS variables (app.css) so
 * one style serves the light and the dark theme, and they match the code-block
 * colours of the visual editor.
 */
export const sourceHighlight = HighlightStyle.define([
  // HTML / XML
  { tag: t.tagName, color: 'var(--src-tag)' },
  { tag: t.angleBracket, color: 'var(--src-punct)' },
  { tag: t.attributeName, color: 'var(--src-attr)' },
  { tag: t.attributeValue, color: 'var(--src-string)' },
  { tag: t.documentMeta, color: 'var(--src-meta)' },
  { tag: t.character, color: 'var(--src-number)' },
  // shared by HTML, CSS and JavaScript
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--src-comment)', fontStyle: 'italic' },
  { tag: [t.string, t.special(t.string)], color: 'var(--src-string)' },
  { tag: [t.number, t.bool, t.atom, t.unit], color: 'var(--src-number)' },
  { tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword], color: 'var(--src-keyword)' },
  { tag: [t.propertyName, t.definition(t.propertyName)], color: 'var(--src-attr)' },
  { tag: [t.className, t.typeName, t.function(t.variableName)], color: 'var(--src-meta)' },
  { tag: t.invalid, color: 'var(--src-invalid)' },
  // Markdown
  { tag: t.heading, color: 'var(--src-heading)', fontWeight: '700' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--src-link)' },
  { tag: t.url, color: 'var(--src-link)', textDecoration: 'underline' },
  { tag: t.monospace, color: 'var(--src-string)' },
  { tag: t.quote, color: 'var(--src-comment)', fontStyle: 'italic' },
  { tag: [t.processingInstruction, t.contentSeparator, t.meta], color: 'var(--src-punct)' },
])
