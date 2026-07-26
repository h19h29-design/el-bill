/* @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PowerPlannerDataSource } from '../../types'
import { POWER_PLANNER_AGGREGATE_RECORD_LIMIT } from '../../lib/powerPlanner'
import { PowerPlannerUpload } from './PowerPlannerUpload'

const hourlyCsv = [
  '일자,시간,사용량(kWh)',
  '2026-07-01,13,420',
  '2026-07-01,14,460',
].join('\n')

afterEach(cleanup)

const uploadCsv = async (container: HTMLElement) => {
  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: {
      files: [new File([hourlyCsv], 'power-planner.csv', { type: 'text/csv' })],
    },
  })
  await screen.findByText('파일을 읽었습니다. 데이터 유형과 컬럼 매핑을 확인해 주세요.')
}

describe('PowerPlannerUpload aggregate limit', () => {
  it('does not add duplicate records when the same file is applied again', async () => {
    const updates: PowerPlannerDataSource[] = []
    const onDataSourceChange = vi.fn(async (next: PowerPlannerDataSource | null) => {
      if (next) updates.push(next)
      return true
    })
    const { container, rerender } = render(
      <PowerPlannerUpload
        dataSource={null}
        dataOrigin="none"
        onDataSourceChange={onDataSourceChange}
      />,
    )

    await uploadCsv(container)
    fireEvent.click(screen.getByRole('button', { name: '매핑 적용' }))
    await waitFor(() => expect(updates).toHaveLength(1))
    const firstSource = updates.at(-1)!
    expect(firstSource.records).toHaveLength(2)

    rerender(
      <PowerPlannerUpload
        dataSource={firstSource}
        dataOrigin="uploaded"
        onDataSourceChange={onDataSourceChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '매핑 적용' }))

    await waitFor(() => expect(updates).toHaveLength(2))
    expect(updates.at(-1)!.records).toHaveLength(2)
    expect(await screen.findByText(/중복 2건은 제외했습니다/)).toBeTruthy()
  })

  it('rejects cumulative overflow without replacing the existing source', async () => {
    const source: PowerPlannerDataSource = {
      id: 'existing-source',
      provider: 'kepco-power-planner',
      sourceName: 'existing.csv',
      sourceLabel: '한전 파워플래너 사용자 업로드',
      importedAt: '2026-07-01T00:00:00.000Z',
      memo: 'existing',
      records: Array.from({ length: POWER_PLANNER_AGGREGATE_RECORD_LIMIT - 1 }, (_, index) => ({
        id: `existing-${index}`,
        dataType: 'hourlyUsage' as const,
        date: `2026-06-${String((index % 28) + 1).padStart(2, '0')}`,
        hour: index % 24,
        usageKwh: index,
        sourceRowIndex: index,
      })),
    }
    const onDataSourceChange = vi.fn(async () => true)
    const { container } = render(
      <PowerPlannerUpload
        dataSource={source}
        dataOrigin="uploaded"
        onDataSourceChange={onDataSourceChange}
      />,
    )

    await uploadCsv(container)
    fireEvent.click(screen.getByRole('button', { name: '매핑 적용' }))

    expect(onDataSourceChange).not.toHaveBeenCalled()
    expect(screen.getByText(/최대 10,000건까지 반영할 수 있습니다/)).toBeTruthy()
  })
})
