import type { MonthlyBill } from '../types'

export type ConnectorStatus =
  | { state: 'unavailable'; reason: string }
  | { state: 'ready'; provider: string }
  | { state: 'error'; message: string }

export interface BillDataConnector {
  id: string
  label: string
  getStatus(): Promise<ConnectorStatus>
  fetchBills(customerReference: string): Promise<MonthlyBill[]>
}

export const manualImportConnector: BillDataConnector = {
  id: 'manual-import',
  label: '직접 입력',
  async getStatus() {
    return { state: 'ready', provider: '브라우저 직접 입력' }
  },
  async fetchBills() {
    throw new Error('직접 입력 연결은 고객번호 자동 조회를 지원하지 않습니다.')
  },
}
