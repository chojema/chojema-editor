/**
 * Pop-up menu for the web build. The desktop app has a native menu bar; in a
 * browser the status-bar document-type button opens this menu instead, so the
 * file commands stay reachable without changing the shared renderer.
 */

export type MenuEntry =
  | { type: 'separator' }
  | { type: 'header'; label: string }
  | { type?: 'item'; label: string; checked?: boolean; enabled?: boolean; shortcut?: string; click: () => void }

let close: (() => void) | null = null

export function popupMenu(entries: MenuEntry[], anchor: Element | null): void {
  close?.()
  const menu = document.createElement('div')
  menu.className = 'web-menu'
  menu.setAttribute('role', 'menu')
  for (const entry of entries) {
    if (entry.type === 'separator') {
      menu.appendChild(Object.assign(document.createElement('div'), { className: 'web-menu-sep' }))
      continue
    }
    if (entry.type === 'header') {
      menu.appendChild(Object.assign(document.createElement('div'), { className: 'web-menu-header', textContent: entry.label }))
      continue
    }
    const item = document.createElement('button')
    item.type = 'button'
    item.className = 'web-menu-item'
    item.setAttribute('role', entry.checked === undefined ? 'menuitem' : 'menuitemradio')
    if (entry.checked !== undefined) item.setAttribute('aria-checked', String(entry.checked))
    item.disabled = entry.enabled === false
    const check = Object.assign(document.createElement('span'), { className: 'web-menu-check', textContent: entry.checked ? '✓' : '' })
    const label = Object.assign(document.createElement('span'), { className: 'web-menu-label', textContent: entry.label })
    const shortcut = Object.assign(document.createElement('span'), { className: 'web-menu-shortcut', textContent: entry.shortcut ?? '' })
    item.append(check, label, shortcut)
    item.addEventListener('click', () => {
      close?.()
      entry.click()
    })
    menu.appendChild(item)
  }
  document.body.appendChild(menu)

  // open upward from the anchor (the status bar sits at the bottom of the window)
  const rect = anchor?.getBoundingClientRect() ?? new DOMRect(8, window.innerHeight, 0, 0)
  const left = Math.max(4, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 4))
  menu.style.left = `${left}px`
  menu.style.top = `${Math.max(4, rect.top - menu.offsetHeight - 4)}px`

  const onPress = (event: Event) => {
    if (!menu.contains(event.target as Node) && !anchor?.contains(event.target as Node)) close?.()
  }
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close?.()
  }
  window.addEventListener('pointerdown', onPress, true)
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('blur', () => close?.(), { once: true })
  close = () => {
    close = null
    menu.remove()
    window.removeEventListener('pointerdown', onPress, true)
    window.removeEventListener('keydown', onKey, true)
  }
  ;(menu.querySelector('.web-menu-item:not(:disabled)') as HTMLElement | null)?.focus()
}

export function closeMenu(): void {
  close?.()
}

/** toggles the menu when its anchor is pressed again */
export function isMenuOpen(): boolean {
  return close !== null
}
