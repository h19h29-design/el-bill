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

export const verifyPdfWorkerAssets = async (assetsDirectory) => {
  const files = await readdir(assetsDirectory)
  const workers = files.filter((filename) =>
    /^pdf\.worker(?:\.min)?-[A-Za-z0-9_-]+\.(?:js|mjs)$/.test(filename),
  )
  const unsafeWorker = workers.find((filename) => filename.endsWith('.mjs'))
  if (unsafeWorker) {
    throw new Error(
      `PDF worker must be emitted as .js for the production static server; found ${unsafeWorker}.`,
    )
  }
  const worker = workers.find((filename) => filename.endsWith('.js'))
  if (!worker) {
    throw new Error(`PDF worker JavaScript asset was not found in ${assetsDirectory}.`)
  }
  return worker
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isCli) {
  const assetsDirectory = process.env.BUNDLE_ASSET_DIR
    ? resolve(process.env.BUNDLE_ASSET_DIR)
    : resolve(process.cwd(), 'dist/assets')

  Promise.all([
    verifyInitialBundle(assetsDirectory),
    verifyPdfWorkerAssets(assetsDirectory),
  ])
    .then(([{ filename, bytes }, pdfWorker]) => {
      console.log(
        `Initial Vite entry ${filename}: ${bytes.toLocaleString('en-US')} bytes (budget ${initialBundleBudgetBytes.toLocaleString('en-US')}).`,
      )
      console.log(`PDF worker asset ${pdfWorker}.`)
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
}
