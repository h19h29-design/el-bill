import { expect, it } from 'vitest'
import { manualImportConnector } from './connectors'

it('keeps the manual connector honest about automatic fetch', async () => {
  await expect(manualImportConnector.getStatus()).resolves.toEqual({
    state: 'ready',
    provider: '브라우저 직접 입력',
  })
  await expect(manualImportConnector.fetchBills('1234567890')).rejects.toThrow(
    '고객번호 자동 조회를 지원하지 않습니다',
  )
})
