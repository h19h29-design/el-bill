/* @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createPowerPlannerDataSource,
  type PowerPlannerSaveResult,
  type PowerPlannerStorageIntent,
} from '../../lib/powerPlanner'
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
  it('sends only incoming records and reports the locked merge result', async () => {
    const onDataSourceChange = vi.fn(
      async (intent: PowerPlannerStorageIntent): Promise<PowerPlannerSaveResult> => {
        expect(intent.type).toBe('merge-upload')
        if (intent.type !== 'merge-upload') return { ok: false }
        return {
          ok: true,
          dataSource: createPowerPlannerDataSource(
            intent.records,
            intent.sourceName,
            intent.memo,
          ),
          duplicateCount: 0,
        }
      },
    )
    const { container } = render(
      <PowerPlannerUpload
        dataSource={null}
        dataOrigin="none"
        onDataSourceChange={onDataSourceChange}
      />,
    )

    await uploadCsv(container)
    fireEvent.click(screen.getByRole('button', { name: '매핑 적용' }))
    await waitFor(() => expect(onDataSourceChange).toHaveBeenCalledTimes(1))

    expect(onDataSourceChange).toHaveBeenCalledWith({
      type: 'merge-upload',
      records: expect.arrayContaining([
        expect.objectContaining({ hour: 13, usageKwh: 420 }),
        expect.objectContaining({ hour: 14, usageKwh: 460 }),
      ]),
      sourceName: 'power-planner.csv',
      memo: '시간대별 사용량 2건 반영',
    })
    expect(
      await screen.findByText(/기존 자료와 합쳐 총 2건입니다/),
    ).toBeTruthy()
  })

  it('shows duplicate and total counts returned by the locked merge', async () => {
    const mergedSource = createPowerPlannerDataSource(
      [
        {
          id: 'existing',
          dataType: 'hourlyUsage',
          date: '2026-07-01',
          hour: 13,
          usageKwh: 420,
          sourceRowIndex: 0,
        },
      ],
      'latest.csv',
      'latest',
    )
    const onDataSourceChange = vi.fn(async (): Promise<PowerPlannerSaveResult> => ({
      ok: true,
      dataSource: mergedSource,
      duplicateCount: 2,
    }))
    const { container } = render(
      <PowerPlannerUpload
        dataSource={null}
        dataOrigin="none"
        onDataSourceChange={onDataSourceChange}
      />,
    )

    await uploadCsv(container)
    fireEvent.click(screen.getByRole('button', { name: '매핑 적용' }))

    expect(await screen.findByText(/중복 2건은 제외했습니다/)).toBeTruthy()
  })

  it('reports a locked aggregate overflow without replacing the visible source', async () => {
    const source = createPowerPlannerDataSource([], 'existing.csv', 'existing')
    const onDataSourceChange = vi.fn(async (): Promise<PowerPlannerSaveResult> => ({
      ok: false,
      message: '파워플래너 자료는 중복 제거 후 최대 10,000건까지 반영할 수 있습니다.',
    }))
    const { container } = render(
      <PowerPlannerUpload
        dataSource={source}
        dataOrigin="uploaded"
        onDataSourceChange={onDataSourceChange}
      />,
    )

    await uploadCsv(container)
    fireEvent.click(screen.getByRole('button', { name: '매핑 적용' }))

    await waitFor(() => expect(onDataSourceChange).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/최대 10,000건까지 반영할 수 있습니다/)).toBeTruthy()
  })
})
