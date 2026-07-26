import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyInitialBundle } from './verify-initial-bundle.mjs'

const temporaryDirectories: string[] = []

const makeDist = async (files: Record<string, number>) => {
  const directory = await mkdtemp(join(tmpdir(), 'el-bill-bundle-'))
  temporaryDirectories.push(directory)
  await Promise.all(
    Object.entries(files).map(async ([name, size]) => {
      await writeFile(join(directory, name), Buffer.alloc(size))
    }),
  )
  return directory
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('verifyInitialBundle', () => {
  it('accepts an initial entry below the 700,000-byte budget', async () => {
    const directory = await makeDist({ 'index-small.js': 699_999, 'excel-large.js': 900_000 })

    await expect(verifyInitialBundle(directory)).resolves.toMatchObject({
      filename: 'index-small.js',
      bytes: 699_999,
    })
  })

  it('rejects an initial entry above the budget', async () => {
    const directory = await makeDist({ 'index-large.js': 700_001 })

    await expect(verifyInitialBundle(directory)).rejects.toThrow('700,000 bytes')
  })
})
