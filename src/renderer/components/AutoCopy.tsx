import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n/locale'

/** a keyboard selection (shift+arrows) counts as made once it rests this long */
const KEYBOARD_SETTLE_MS = 450
const FLASH_MS = 1100

/** where selections may be copied from: the editors, never the app's own inputs */
const EDITABLE_AREAS = '.ProseMirror, .cm-content'

interface Flash {
  id: number
  x: number
  y: number
}

/**
 * Copy on select: a finished selection in an editor goes to the clipboard at
 * once. The copy runs through the browser's copy command, so each editor's own
 * clipboard handling applies (rich text from the visual editor, exact source
 * text from CodeMirror), and a small "Copied" tag appears beside the selection.
 */
export function AutoCopy({ enabled }: { enabled: boolean }) {
  const [flash, setFlash] = useState<Flash | null>(null)
  const lastCopied = useRef('')
  const pointer = useRef({ x: 0, y: 0, down: false })

  useEffect(() => {
    if (!enabled) return
    let settleTimer = 0
    let flashTimer = 0

    const copySelection = () => {
      const selection = window.getSelection()
      const text = selection?.toString() ?? ''
      if (!selection || selection.isCollapsed || !text.trim()) {
        lastCopied.current = ''
        return
      }
      const anchor = selection.anchorNode
      const element = anchor instanceof Element ? anchor : anchor?.parentElement
      if (!element?.closest(EDITABLE_AREAS)) return
      // the same selection reported again (focus changes, re-renders) is not copied twice
      if (text === lastCopied.current) return
      if (!document.execCommand('copy')) return
      lastCopied.current = text
      const rect = selection.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null
      const placed = rect && rect.width + rect.height > 0
      setFlash({
        id: Date.now(),
        x: placed ? rect.right : pointer.current.x,
        y: placed ? rect.bottom : pointer.current.y,
      })
      window.clearTimeout(flashTimer)
      flashTimer = window.setTimeout(() => setFlash(null), FLASH_MS)
    }

    const onDown = (event: MouseEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY, down: true }
    }
    // a mouse selection is finished when the button comes up
    const onUp = (event: MouseEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY, down: false }
      window.clearTimeout(settleTimer)
      window.setTimeout(copySelection, 0)
    }
    const onSelectionChange = () => {
      if (pointer.current.down) return
      window.clearTimeout(settleTimer)
      settleTimer = window.setTimeout(copySelection, KEYBOARD_SETTLE_MS)
    }

    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('mouseup', onUp, true)
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('mouseup', onUp, true)
      document.removeEventListener('selectionchange', onSelectionChange)
      window.clearTimeout(settleTimer)
      window.clearTimeout(flashTimer)
      lastCopied.current = ''
    }
  }, [enabled])

  if (!flash) return null
  // keep the tag on screen near the right and bottom edges
  const left = Math.min(flash.x + 6, window.innerWidth - 90)
  const top = Math.min(flash.y + 6, window.innerHeight - 60)
  return (
    <div key={flash.id} className="copy-flash" style={{ left, top }} role="status" aria-live="polite">
      ✓ {t('copiedFlash')}
    </div>
  )
}
