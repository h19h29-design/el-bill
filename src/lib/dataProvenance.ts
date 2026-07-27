import type { BillDataOrigin } from '../types'

export const isUserBillOrigin = (origin: BillDataOrigin): boolean =>
  origin !== 'sample'

export const getBillOriginLabel = (origin: BillDataOrigin): string => {
  switch (origin) {
    case 'sample':
      return '시연 샘플'
    case 'uploaded':
      return '파일 업로드'
    case 'pasted':
      return '표 붙여넣기'
    case 'manual':
      return '직접 입력'
  }
}
