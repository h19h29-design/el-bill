import { validateUploadFile } from './excel'

export const supportsDirectoryPicker = () =>
  typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'

export type DirectoryImportResult =
  | { ok: true; file: File }
  | { ok: false; reason: 'unsupported' | 'cancelled' | 'no-supported-file' | 'read-error' }

const hasXlsxSignature = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer, 0, 4)
  return bytes.length === 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
}

const isPowerPlannerHtml = (buffer: ArrayBuffer) => {
  const text = new TextDecoder('utf-8').decode(buffer)
  return /ui-jqgrid/i.test(text) &&
    /aria-describedby\s*=\s*["']\s*grid_/i.test(text)
}

const hasSupportedContents = async (file: File) => {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv')) return true

  const buffer = await file.arrayBuffer()
  if (name.endsWith('.xlsx')) return hasXlsxSignature(buffer)
  return isPowerPlannerHtml(buffer)
}

const newestFirst = (left: File, right: File) =>
  right.lastModified - left.lastModified ||
  (left.name < right.name ? -1 : left.name > right.name ? 1 : 0)

export const selectNewestSupportedFile = async (
  directory: FileSystemDirectoryHandle,
): Promise<DirectoryImportResult> => {
  const candidates: File[] = []

  try {
    for await (const handle of directory.values()) {
      if (handle.kind !== 'file') continue
      const file = await handle.getFile()
      if (validateUploadFile(file) || !await hasSupportedContents(file)) continue
      candidates.push(file)
    }
  } catch {
    return { ok: false, reason: 'read-error' }
  }

  const file = candidates.sort(newestFirst)[0]
  return file
    ? { ok: true, file }
    : { ok: false, reason: 'no-supported-file' }
}

const isPickerCancellation = (error: unknown) =>
  error instanceof DOMException &&
  (error.name === 'AbortError' || error.name === 'NotAllowedError')

export const chooseNewestSupportedFile = async (): Promise<DirectoryImportResult> => {
  if (!supportsDirectoryPicker()) return { ok: false, reason: 'unsupported' }

  try {
    const directory = await window.showDirectoryPicker?.({ mode: 'read' })
    return directory
      ? selectNewestSupportedFile(directory)
      : { ok: false, reason: 'unsupported' }
  } catch (error) {
    return isPickerCancellation(error)
      ? { ok: false, reason: 'cancelled' }
      : { ok: false, reason: 'read-error' }
  }
}
