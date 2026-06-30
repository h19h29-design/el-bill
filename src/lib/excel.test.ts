import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseWorkbook } from './excel'

const attachedWorkbook = '/Users/mac-mini/Downloads/0. 전기요금-등촌고.xlsx'

describe('attached workbook parser harness', () => {
  it.runIf(existsSync(attachedWorkbook))(
    'auto-merges the provided yearly electricity sheets',
    async () => {
      const buffer = readFileSync(attachedWorkbook)
      const arrayBuffer = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      )
      const result = await parseWorkbook(arrayBuffer)
      const may2025 = result.autoRows.find(
        (bill) => bill.year === 2025 && bill.month === 5,
      )

      expect(result.autoRows.length).toBeGreaterThanOrEqual(60)
      expect(may2025?.usageKwh).toBe(29232)
      expect(may2025?.totalBillWon).toBe(4897870)
    },
  )
})
