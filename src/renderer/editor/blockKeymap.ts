import { Extension } from '@tiptap/core'
import { moveSelectedBlocks, uiOp } from './ops'

/** asks the toolbar to open its link popover (Electron has no window.prompt) */
export const OPEN_LINK_EVENT = 'chojema-open-link'

export function requestLinkPopover(): boolean {
  window.dispatchEvent(new CustomEvent(OPEN_LINK_EVENT))
  return true
}

/** ⌘K alone, for editors that do not take the other block shortcuts */
export const LinkShortcut = Extension.create({
  name: 'linkShortcut',
  addKeyboardShortcuts: () => ({ 'Mod-k': requestLinkPopover }),
})

/**
 * SecondBrain-parity block shortcuts: ⌘D duplicate, ⌘⇧⌫ delete,
 * ⌘⇧↑/↓ move the current top-level block, ⌘K link.
 */
export const BlockKeymap = Extension.create({
  name: 'blockKeymap',

  addKeyboardShortcuts() {
    return {
      'Mod-d': () => uiOp(this.editor, { op: 'duplicateBlocks', target: 'selection' }),
      'Mod-D': () => uiOp(this.editor, { op: 'duplicateBlocks', target: 'selection' }),
      'Mod-Shift-Backspace': () => uiOp(this.editor, { op: 'deleteBlocks', target: 'selection' }),
      'Mod-Shift-ArrowUp': () => moveSelectedBlocks(this.editor, -1),
      'Mod-Shift-ArrowDown': () => moveSelectedBlocks(this.editor, 1),
      'Mod-k': requestLinkPopover,
    }
  },
})
