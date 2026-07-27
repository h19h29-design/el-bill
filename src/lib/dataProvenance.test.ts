import { describe, expect, it } from 'vitest'
import {
  getBillOriginLabel,
  isUserBillOrigin,
} from './dataProvenance'

describe('bill provenance', () => {
  it.each(['uploaded', 'pasted', 'manual'] as const)(
    'treats %s as user-provided data',
    (origin) => expect(isUserBillOrigin(origin)).toBe(true),
  )

  it('uses distinct reader-facing labels', () => {
    expect(getBillOriginLabel('sample')).toBe('시연 샘플')
    expect(getBillOriginLabel('uploaded')).toBe('파일 업로드')
    expect(getBillOriginLabel('pasted')).toBe('표 붙여넣기')
    expect(getBillOriginLabel('manual')).toBe('직접 입력')
  })
})
