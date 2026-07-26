import { readdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const initialBundleBudgetBytes = 700_000

export const verifyInitialBundle = async (assetsDirectory) => {
  const files = await readdir(assetsDirectory)
  const entryCandidates = files.filter((filename) =>
    /^index-[A-Za-z0-9_-]+\.js$/.test(filename),
  )

  if (entryCandidates.length === 0) {
    throw new Error(`Initial Vite entry chunk was not found in ${assetsDirectory}.`)
  }

  const entries = await Promise.all(
    entryCandidates.map(async (filename) => ({
      filename,
      bytes: (await stat(resolve(assetsDirectory, filename))).size,
    })),
  )
  const entry = entries.reduce((largest, candidate) =>
    candidate.bytes > largest.bytes ? candidate : largest,
  )

  if (entry.bytes > initialBundleBudgetBytes) {
    throw new Error(
      `Initial Vite entry ${entry.filename} is ${entry.bytes.toLocaleString('en-US')} bytes; budget is ${initialBundleBudgetBytes.toLocaleString('en-US')} bytes.`,
    )
  }

  return entry
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isCli) {
  const assetsDirectory = process.env.BUNDLE_ASSET_DIR
    ? resolve(process.env.BUNDLE_ASSET_DIR)
    : resolve(process.cwd(), 'dist/assets')

  verifyInitialBundle(assetsDirectory)
    .then(({ filename, bytes }) => {
      console.log(
        `Initial Vite entry ${filename}: ${bytes.toLocaleString('en-US')} bytes (budget ${initialBundleBudgetBytes.toLocaleString('en-US')}).`,
      )
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
}
