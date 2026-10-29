/**
 * Small IndexedDB key-value store. It holds what has to outlive a reload or
 * cross into another tab: the tab's document, file handles (structured-clonable,
 * unlike anything localStorage can keep) and files handed to a new tab.
 */

const DB_NAME = 'chojema-editor'
const STORE = 'kv'

let dbPromise: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return dbPromise
}

async function run<T>(mode: IDBTransactionMode, use: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const store = (await db()).transaction(STORE, mode).objectStore(STORE)
  return new Promise((resolve, reject) => {
    const request = use(store)
    request.onsuccess = () => resolve(request.result as T)
    request.onerror = () => reject(request.error)
  })
}

export async function getItem<T>(key: string): Promise<T | undefined> {
  try {
    return await run<T | undefined>('readonly', (store) => store.get(key))
  } catch {
    return undefined
  }
}

export async function setItem(key: string, value: unknown): Promise<void> {
  try {
    await run('readwrite', (store) => store.put(value, key))
  } catch {
    // a blocked store (private mode) only costs reload persistence
  }
}

export async function deleteItem(key: string): Promise<void> {
  try {
    await run('readwrite', (store) => store.delete(key))
  } catch {
    // nothing to clean up
  }
}

export function randomId(): string {
  return crypto.randomUUID()
}

export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // preferences are a convenience; a blocked store just forgets them
  }
}

/** per-tab id, so a reload finds this tab's document again */
export function tabId(): string {
  try {
    let id = sessionStorage.getItem('chojema.tab')
    if (!id) {
      id = randomId()
      sessionStorage.setItem('chojema.tab', id)
    }
    return id
  } catch {
    return 'default'
  }
}
