import { useCallback, useState } from 'react'

const KEY = 'chojema.outline'

/** whether the outline pane is shown, remembered across windows */
export function useOutlinePref(): [boolean, (open: boolean) => void] {
  const [open, setOpenState] = useState(() => {
    try {
      return localStorage.getItem(KEY) === '1'
    } catch {
      return false
    }
  })
  const setOpen = useCallback((next: boolean) => {
    setOpenState(next)
    try {
      localStorage.setItem(KEY, next ? '1' : '0')
    } catch {
      // the choice is only remembered when storage is available
    }
  }, [])
  return [open, setOpen]
}
