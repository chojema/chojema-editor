/**
 * File access in the browser. Chromium browsers have the File System Access
 * API (pickers and handles that can be written back); elsewhere opening is a
 * file input and saving is a download.
 */

export interface FileHandle {
  readonly kind: 'file'
  readonly name: string
  getFile(): Promise<File>
  createWritable(): Promise<{ write(data: Blob | string): Promise<void>; close(): Promise<void> }>
  queryPermission?(options: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission?(options: { mode: 'readwrite' }): Promise<PermissionState>
}

interface PickerType {
  description: string
  accept: Record<string, string[]>
}

interface FsWindow {
  showOpenFilePicker?(options: { multiple?: boolean; types?: PickerType[] }): Promise<FileHandle[]>
  showSaveFilePicker?(options: { suggestedName?: string; types?: PickerType[] }): Promise<FileHandle>
}

const fsWindow = window as unknown as FsWindow

export const canWriteFiles = typeof fsWindow.showSaveFilePicker === 'function'

export interface OpenedFile {
  file: File
  handle: FileHandle | null
}

/** the user closed the picker: not an error worth reporting */
export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export const DOCUMENT_TYPES: PickerType[] = [
  {
    description: 'Documents',
    accept: { 'text/markdown': ['.md', '.markdown'], 'text/html': ['.html', '.htm'], 'text/plain': ['.txt'] },
  },
]

/** hidden <input type=file>; resolves [] when the dialog is dismissed */
function inputPick(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = multiple
    input.addEventListener('change', () => resolve(Array.from(input.files ?? [])))
    input.addEventListener('cancel', () => resolve([]))
    input.click()
  })
}

export async function pickFiles(options: { accept: string; types: PickerType[]; multiple: boolean }): Promise<OpenedFile[]> {
  if (fsWindow.showOpenFilePicker) {
    try {
      const handles = await fsWindow.showOpenFilePicker({ multiple: options.multiple, types: options.types })
      return Promise.all(handles.map(async (handle) => ({ file: await handle.getFile(), handle })))
    } catch (error) {
      if (isAbort(error)) return []
      throw error
    }
  }
  return (await inputPick(options.accept, options.multiple)).map((file) => ({ file, handle: null }))
}

/** ask for a save location; null when the user cancelled */
export async function pickSaveHandle(suggestedName: string, types: PickerType[]): Promise<FileHandle | null> {
  try {
    return await fsWindow.showSaveFilePicker!({ suggestedName, types })
  } catch (error) {
    if (isAbort(error)) return null
    throw error
  }
}

export async function writeHandle(handle: FileHandle, data: Blob | string): Promise<boolean> {
  if (handle.queryPermission && (await handle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
    if ((await handle.requestPermission?.({ mode: 'readwrite' })) !== 'granted') return false
  }
  const writable = await handle.createWritable()
  await writable.write(data)
  await writable.close()
  return true
}

export function download(name: string, data: Blob | string, type: string): void {
  const blob = typeof data === 'string' ? new Blob([data], { type }) : data
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** save a new file: picker where available, download otherwise; null when cancelled */
export async function saveNewFile(
  suggestedName: string,
  data: string,
  type: { description: string; mime: string; ext: string },
): Promise<string | null> {
  if (!canWriteFiles) {
    download(suggestedName, data, type.mime)
    return suggestedName
  }
  const handle = await pickSaveHandle(suggestedName, [{ description: type.description, accept: { [type.mime]: [`.${type.ext}`] } }])
  if (!handle) return null
  if (!(await writeHandle(handle, data))) return null
  return handle.name
}

export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
