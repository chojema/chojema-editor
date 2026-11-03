import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import type { Node } from '@tiptap/pm/model'

export function validMarkdownTables(doc: Node): boolean {
  let valid = true
  doc.descendants((node, _pos, parent) => {
    if (node.type.name === 'table') {
      node.descendants(child => {
        if (child.type.name === 'table') valid = false
        if ((child.type.name === 'tableCell' || child.type.name === 'tableHeader') && (child.attrs.colspan > 1 || child.attrs.rowspan > 1)) valid = false
      })
      if (!node.firstChild || Array.from({ length: node.firstChild.childCount }, (_, i) => node.firstChild!.child(i)).some(cell => cell.type.name !== 'tableHeader')) valid = false
      node.forEach((row, _offset, index) => { if (index > 0) row.forEach(cell => { if (cell.type.name === 'tableHeader') valid = false }) })
    }
    if (node.type.name === 'tableHeader' && parent?.type.name !== 'tableRow') valid = false
  })
  return valid
}

/** All entry points, including paste and commands, must stay representable in GFM. */
export const MarkdownTableSafety = Extension.create({
  name: 'markdownTableSafety',
  addProseMirrorPlugins: () => [new Plugin({
    filterTransaction: tr => !tr.docChanged || validMarkdownTables(tr.doc),
  })],
})
