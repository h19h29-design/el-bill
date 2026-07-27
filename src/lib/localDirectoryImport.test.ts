/* @vitest-environment jsdom */

import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  chooseNewestSupportedFile,
  selectNewestSupportedFile,
  supportsDirectoryPicker,
  type DirectoryImportResult,
} from './localDirectoryImport'

type DirectoryEntry = {
  kind: 'file' | 'directory'
  name: string
  getFile?: () => Promise<File>
}

const validXlsxSignature = new Uint8Array([0x50, 0x4b, 0x03, 0x04])

const file = (
  name: string,
  lastModified: number,
  contents: BlobPart = validXlsxSignature,
) => new File([contents], name, { lastModified })

const directory = (entries: DirectoryEntry[]) => ({
  values: async function* () {
    yield* entries
  },
})

const fileEntry = (value: File): DirectoryEntry => ({
  kind: 'file',
  name: value.name,
  getFile: async () => value,
})

afterEach(() => {
  delete (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker
  vi.restoreAllMocks()
})

describe('local directory import', () => {
  it('keeps the documented failure result union unchanged', () => {
    expectTypeOf<Exclude<DirectoryImportResult, { ok: true }>>().toEqualTypeOf<{
      ok: false
      reason: 'unsupported' | 'cancelled' | 'no-supported-file' | 'read-error'
    }>()
  })

  it('returns the newest valid top-level bill export, breaking timestamp ties by filename', async () => {
    const newest = file('a-newest.csv', 1_740_000_000_000, 'year,month\n2026,7')
    const result = await selectNewestSupportedFile(directory([
      fileEntry(file('older.xlsx', 1_730_000_000_000)),
      fileEntry(file('z-newest.xls', 1_740_000_000_000, '<html class="ui-jqgrid"><td aria-describedby="grid_bill"></td></html>')),
      fileEntry(newest),
    ]) as never)

    expect(result).toEqual({ ok: true, file: newest })
  })

  it('ignores nested directories when selecting a bill export', async () => {
    const topLevel = file('top-level.csv', 1_740_000_000_000, 'year,month\n2026,7')
    const result = await selectNewestSupportedFile(directory([
      { kind: 'directory', name: 'nested' },
      fileEntry(topLevel),
    ]) as never)

    expect(result).toEqual({ ok: true, file: topLevel })
  })

  it('skips files with an invalid XLSX signature', async () => {
    const valid = file('bill.csv', 1_730_000_000_000, 'year,month\n2026,7')
    const result = await selectNewestSupportedFile(directory([
      fileEntry(file('newer-but-invalid.xlsx', 1_740_000_000_000, 'not a zip archive')),
      fileEntry(valid),
    ]) as never)

    expect(result).toEqual({ ok: true, file: valid })
  })

  it('skips a shorter-than-signature XLSX candidate and continues to a valid later file', async () => {
    const valid = file('later.csv', 1_730_000_000_000, 'year,month\n2026,7')
    const result = await selectNewestSupportedFile(directory([
      fileEntry(file('short.xlsx', 1_740_000_000_000, new Uint8Array([0x50, 0x4b]))),
      fileEntry(valid),
    ]) as never)

    expect(result).toEqual({ ok: true, file: valid })
  })

  it('reports no supported file when every entry is unsupported', async () => {
    const result = await selectNewestSupportedFile(directory([
      fileEntry(file('notes.txt', 1_740_000_000_000, 'notes')),
      { kind: 'directory', name: 'archives' },
    ]) as never)

    expect(result).toEqual({ ok: false, reason: 'no-supported-file' })
  })

  it('ignores unreadable unsupported file handles before a valid bill file', async () => {
    const unreadableNotes = vi.fn().mockRejectedValue(
      new DOMException('Permission denied', 'NotAllowedError'),
    )
    const valid = file('bill.CSV', 1_740_000_000_000, 'year,month\n2026,7')
    const result = await selectNewestSupportedFile(directory([
      { kind: 'file', name: 'notes.TxT', getFile: unreadableNotes },
      fileEntry(valid),
    ]) as never)

    expect(result).toEqual({ ok: true, file: valid })
    expect(unreadableNotes).not.toHaveBeenCalled()
  })

  it('reports directory picker cancellation without treating it as an import error', async () => {
    ;(globalThis as { showDirectoryPicker?: () => Promise<never> }).showDirectoryPicker =
      vi.fn().mockRejectedValue(new DOMException('The user aborted a request.', 'AbortError'))

    expect(supportsDirectoryPicker()).toBe(true)
    await expect(chooseNewestSupportedFile()).resolves.toEqual({
      ok: false,
      reason: 'cancelled',
    })
  })

  it('reports picker permission denial as a read error, not cancellation', async () => {
    ;(globalThis as { showDirectoryPicker?: () => Promise<never> }).showDirectoryPicker =
      vi.fn().mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'))

    await expect(chooseNewestSupportedFile()).resolves.toEqual({
      ok: false,
      reason: 'read-error',
    })
  })

  it('reports no supported file from a picker-selected directory', async () => {
    ;(globalThis as { showDirectoryPicker?: () => Promise<unknown> }).showDirectoryPicker =
      vi.fn().mockResolvedValue(directory([
        fileEntry(file('notes.txt', 1_740_000_000_000, 'notes')),
      ]))

    await expect(chooseNewestSupportedFile()).resolves.toEqual({
      ok: false,
      reason: 'no-supported-file',
    })
  })

  it('reports a supported unreadable bill file as a read error', async () => {
    const result = await selectNewestSupportedFile(directory([
      {
        kind: 'file',
        name: 'BILL.CSV',
        getFile: async () => {
          throw new DOMException('Permission denied', 'NotAllowedError')
        },
      },
    ]) as never)

    expect(result).toEqual({ ok: false, reason: 'read-error' })
  })

  it('reports picker directory read errors', async () => {
    ;(globalThis as { showDirectoryPicker?: () => Promise<unknown> }).showDirectoryPicker =
      vi.fn().mockResolvedValue(directory([
        {
          kind: 'file',
          name: 'bill.csv',
          getFile: async () => {
            throw new DOMException('Permission denied', 'NotAllowedError')
          },
        },
      ]))

    await expect(chooseNewestSupportedFile()).resolves.toEqual({
      ok: false,
      reason: 'read-error',
    })
  })

  it('reports an unreadable directory entry as a read error', async () => {
    const result = await selectNewestSupportedFile(directory([
      {
        kind: 'file',
        name: 'bill.csv',
        getFile: async () => {
          throw new DOMException('Permission denied', 'NotAllowedError')
        },
      },
    ]) as never)

    expect(result).toEqual({ ok: false, reason: 'read-error' })
  })
})
