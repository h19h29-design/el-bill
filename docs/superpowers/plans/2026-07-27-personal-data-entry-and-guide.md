# Personal Data Entry and Usage Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reliable paste and spreadsheet-style manual bill entry, a personal-use guide with a safe GPT conversion prompt, optional local folder selection, and 24-hour draft retention without weakening the existing diagnosis workflow.

**Architecture:** Keep all bill contents in the browser. Normalize file, pasted, and manually entered rows through one validation path before replacing the active diagnosis snapshot. Store incomplete manual rows in a separate bounded, expiring draft protected by the existing storage lock; keep future EDS support as a typed connector boundary only, with no API server or fake connected state.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Vitest, Testing Library, Playwright, existing browser-local ExcelJS/CSV parser, Web Locks API, File System Access API feature detection.

## Global Constraints

- Do not add KEPCO or Power Planner automatic login, crawling, browser automation, or unofficial API calls.
- Do not add a NAS API server, email integration, OCR, GPT API call, or OpenAI API key.
- Do not upload bill source files or manual entries to the server.
- Limit pasted and manually entered bill data to 36 rows.
- Require year, month, usage, and total bill; never infer a missing required source value.
- Keep optional missing fields unobserved instead of converting them into observed zero values.
- Keep draft creation-to-expiry duration at no more than 24 hours and never extend expiry on edit.
- Keep the existing 24-hour applied-data deletion, anonymous `A고등학교` sample, internal-estimate notice, and one-year rate-change caution.
- Do not show EDS as connected without an approved official service and credentials.
- Preserve existing XLSX, CSV, Power Planner HTML `.xls`, diagnosis, peak management, and document-generation behavior.
- Execute implementation in an isolated worktree on branch `codex/personal-data-entry-guide`.
- Run `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`, and `npm run test:e2e` before deployment.

---

### Task 1: Bill provenance and connector contracts

**Files:**
- Modify: `src/types.ts`
- Create: `src/lib/dataProvenance.ts`
- Create: `src/lib/dataProvenance.test.ts`
- Create: `src/lib/connectors.ts`
- Create: `src/lib/connectors.test.ts`
- Modify: `src/lib/storage.ts`
- Modify: `src/lib/storageSnapshot.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/App.atomic-storage.test.tsx`
- Modify: `src/components/layout/TopNotice.tsx`
- Modify: `src/components/dashboard/Dashboard.tsx`
- Modify: `src/components/dashboard/Dashboard.test.tsx`
- Modify: `src/components/diagnosis/AutoDiagnosis.tsx`
- Modify: `src/components/diagnosis/AutoDiagnosis.test.tsx`

**Interfaces:**
- Produces:

```ts
export type BillDataOrigin = 'sample' | 'uploaded' | 'pasted' | 'manual'

export const isUserBillOrigin = (origin: BillDataOrigin): boolean
export const getBillOriginLabel = (origin: BillDataOrigin): string

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

export const manualImportConnector: BillDataConnector
```

- Changes:

```ts
const applyBillsAndOpenDiagnosis = async (
  nextBills: MonthlyBill[],
  origin: Exclude<BillDataOrigin, 'sample'>,
): Promise<boolean>
```

- `manualImportConnector.getStatus()` resolves to
  `{ state: 'ready', provider: '브라우저 직접 입력' }`.
- `manualImportConnector.fetchBills()` rejects with
  `직접 입력 연결은 고객번호 자동 조회를 지원하지 않습니다.`.

- [ ] **Step 1: Write failing provenance and connector tests**

```ts
import { describe, expect, it } from 'vitest'
import {
  getBillOriginLabel,
  isUserBillOrigin,
} from './dataProvenance'
import { manualImportConnector } from './connectors'

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

it('keeps the manual connector honest about automatic fetch', async () => {
  await expect(manualImportConnector.getStatus()).resolves.toEqual({
    state: 'ready',
    provider: '브라우저 직접 입력',
  })
  await expect(manualImportConnector.fetchBills('1234567890')).rejects.toThrow(
    '고객번호 자동 조회를 지원하지 않습니다',
  )
})
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run:

```bash
npx vitest run src/lib/dataProvenance.test.ts src/lib/connectors.test.ts
```

Expected: FAIL because the modules and extended origin union do not exist.

- [ ] **Step 3: Implement contracts and origin helpers**

Add the exact interfaces above. Use `isUserBillOrigin` everywhere that currently
checks `dataProvenance.bills === 'uploaded'`. Use `getBillOriginLabel` in
TopNotice, Dashboard, and AutoDiagnosis instead of binary ternaries.

- [ ] **Step 4: Accept new origins in persisted snapshots**

Change `isValidDataProvenance` in `src/lib/storage.ts` to accept all four bill
origins while retaining the existing Power Planner origin union. Add snapshot
round-trip tests for `pasted` and `manual`; do not change legacy migration rules
that distrust malformed or incomplete old payloads.

- [ ] **Step 5: Pass origin through the App save boundary**

Change `applyBillsAndOpenDiagnosis` to write the supplied origin in the same
`rotateNewStorageSnapshot` update as the bills. Keep one atomic save and only
navigate to diagnosis after it succeeds.

- [ ] **Step 6: Run focused and regression tests**

Run:

```bash
npx vitest run src/lib/dataProvenance.test.ts src/lib/connectors.test.ts src/lib/storageSnapshot.test.ts src/App.atomic-storage.test.tsx src/components/dashboard/Dashboard.test.tsx src/components/diagnosis/AutoDiagnosis.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/lib/dataProvenance.ts src/lib/dataProvenance.test.ts src/lib/connectors.ts src/lib/connectors.test.ts src/lib/storage.ts src/lib/storageSnapshot.test.ts src/App.tsx src/App.atomic-storage.test.tsx src/components/layout/TopNotice.tsx src/components/dashboard/Dashboard.tsx src/components/dashboard/Dashboard.test.tsx src/components/diagnosis/AutoDiagnosis.tsx src/components/diagnosis/AutoDiagnosis.test.tsx
git commit -m "feat: distinguish personal bill input sources"
```

---

### Task 2: Shared pasted and manual bill normalization

**Files:**
- Create: `src/lib/billInput.ts`
- Create: `src/lib/billInput.test.ts`
- Modify: `src/lib/excel.ts`
- Modify: `src/lib/excel.test.ts`

**Interfaces:**
- Consumes: `BillImportContext`, `MonthlyBill`, `ParsedSheet`,
  `mapRowsToBills`, `validateBillPeriods`.
- Produces:

```ts
export const standardBillCsvHeaders: readonly string[]

export type ManualBillDraftField =
  | 'yearMonth'
  | 'usageKwh'
  | 'totalBillWon'
  | 'maxDemandKw'
  | 'appliedPowerKw'
  | 'baseChargeWon'
  | 'energyChargeWon'
  | 'powerFactorChargeWon'
  | 'climateChargeWon'
  | 'fuelAdjustmentWon'
  | 'vatWon'
  | 'fundWon'
  | 'note'

export interface ManualBillDraftRow {
  id: string
  yearMonth: string
  usageKwh: string
  totalBillWon: string
  maxDemandKw: string
  appliedPowerKw: string
  baseChargeWon: string
  energyChargeWon: string
  powerFactorChargeWon: string
  climateChargeWon: string
  fuelAdjustmentWon: string
  vatWon: string
  fundWon: string
  note: string
}

export interface BillInputIssue {
  rowId: string
  field: ManualBillDraftField | 'period'
  message: string
}

export interface BillInputValidation {
  bills: MonthlyBill[]
  issues: BillInputIssue[]
}

export const createManualBillRows = (
  lastYearMonth: string,
  count: 12 | 36,
): ManualBillDraftRow[]

export const buildBillColumnMapping = (
  headers: string[],
): Record<string, string>

export const parseDelimitedMatrix = (
  text: string,
  delimiter: ',' | '\t',
): string[][]

export const parsePastedBillSheet = (text: string): ParsedSheet

export const applyMatrixToDraftRows = (
  rows: ManualBillDraftRow[],
  startRowIndex: number,
  startField: ManualBillDraftField,
  matrix: string[][],
  visibleFields: ManualBillDraftField[],
): ManualBillDraftRow[]

export const validateManualBillRows = (
  rows: ManualBillDraftRow[],
  context?: BillImportContext,
): BillInputValidation

export const createStandardBillCsv = (): string
```

- [ ] **Step 1: Write failing normalization tests**

Use this complete test helper:

```ts
import { defaultRatePlans } from '../data/ratePlans'

const importContext: BillImportContext = {
  appliedPowerKw: 497,
  currentPlan: defaultRatePlans[0],
}

const makeDraft = (
  patch: Partial<ManualBillDraftRow> = {},
): ManualBillDraftRow => ({
  id: 'row-1',
  yearMonth: '',
  usageKwh: '',
  totalBillWon: '',
  maxDemandKw: '',
  appliedPowerKw: '',
  baseChargeWon: '',
  energyChargeWon: '',
  powerFactorChargeWon: '',
  climateChargeWon: '',
  fuelAdjustmentWon: '',
  vatWon: '',
  fundWon: '',
  note: '',
  ...patch,
})
```

Cover these exact cases:

```ts
it('creates 12 descending periods ending at the selected month', () => {
  const rows = createManualBillRows('2026-07', 12)
  expect(rows.map((row) => row.yearMonth)).toEqual([
    '2026-07', '2026-06', '2026-05', '2026-04',
    '2026-03', '2026-02', '2026-01', '2025-12',
    '2025-11', '2025-10', '2025-09', '2025-08',
  ])
})

it('parses tab-separated copied spreadsheet cells', () => {
  const sheet = parsePastedBillSheet(
    '연도\\t월\\t사용량(kWh)\\t총 전기요금(원)\\n2026\\t7\\t48,365 kWh\\t7,138,790원',
  )
  expect(sheet.headers).toEqual([
    '연도', '월', '사용량(kWh)', '총 전기요금(원)',
  ])
  expect(sheet.rows[0]['사용량(kWh)']).toBe('48,365 kWh')
})

it('blocks every duplicate period instead of selecting one', () => {
  const result = validateManualBillRows(
    [
      makeDraft({ id: 'a', yearMonth: '2026-07', usageKwh: '10', totalBillWon: '100' }),
      makeDraft({ id: 'b', yearMonth: '2026-07', usageKwh: '20', totalBillWon: '200' }),
    ],
    importContext,
  )
  expect(result.bills).toEqual([])
  expect(result.issues.filter((issue) => issue.field === 'period')).toHaveLength(2)
})

it('does not mark empty optional fields as observed', () => {
  const result = validateManualBillRows(
    [makeDraft({ yearMonth: '2026-07', usageKwh: '10', totalBillWon: '100' })],
    importContext,
  )
  expect(result.bills[0].observedFields).not.toContain('maxDemandKw')
})
```

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
npx vitest run src/lib/billInput.test.ts
```

Expected: FAIL because `billInput.ts` does not exist.

- [ ] **Step 3: Generalize the existing CSV parser**

Rename the private CSV matrix routine to exported `parseDelimitedMatrix`.
Parameterize only the delimiter character. Keep RFC 4180 double-quote handling,
CRLF handling, BOM removal, trimming, row bounds, and existing CSV behavior.
Use it from the workbook CSV path so there is one parser.

- [ ] **Step 4: Implement period generation and pasted-sheet parsing**

Parse `YYYY-MM` strictly. Reject impossible input rather than rolling dates.
Use integer month arithmetic so January transitions to December correctly.
Detect tab-delimited input when the first non-empty line contains a tab;
otherwise parse as comma-delimited CSV.

- [ ] **Step 5: Implement manual validation through existing domain rules**

Convert each draft row into a record compatible with `mapRowsToBills`.
Use the exact current rate plan context for inferred charge components. Before
returning bills, reject incomplete rows, invalid periods, zero or negative
required values, invalid optional numeric values, and every duplicate period.
Then call the existing period validator so input and diagnosis agree.

- [ ] **Step 6: Implement standard CSV output**

Return a BOM-prefixed UTF-8 CSV string with the exact approved headers:

```text
연도,월,사용량(kWh),총 전기요금(원),요금적용전력(kW),최대수요전력(kW),기본요금(원),전력량요금(원),역률요금(원),기후환경요금(원),연료비조정액(원),부가세(원),전력산업기반기금(원),메모
```

Include one empty data row containing only delimiters so spreadsheet programs
open the columns immediately.

- [ ] **Step 7: Run focused tests**

```bash
npx vitest run src/lib/billInput.test.ts src/lib/excel.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/billInput.ts src/lib/billInput.test.ts src/lib/excel.ts src/lib/excel.test.ts
git commit -m "feat: normalize pasted and manual bill rows"
```

---

### Task 3: Expiring manual-entry draft storage

**Files:**
- Create: `src/lib/billDraftStorage.ts`
- Create: `src/lib/billDraftStorage.test.ts`
- Modify: `src/lib/storage.ts`
- Modify: `src/lib/storageLock.test.ts`

**Interfaces:**
- Consumes: `ManualBillDraftRow`, `storageMutationLockName`,
  `readStorageActivePointer`.
- Produces:

```ts
export interface BillEntryDraft {
  version: 1
  sessionId: string
  revision: number
  createdAt: string
  expiresAt: string
  rows: ManualBillDraftRow[]
}

export type BillDraftWriteResult =
  | { ok: true; draft: BillEntryDraft }
  | { ok: false; reason: 'invalid' | 'expired' | 'stale' | 'storage-error' | 'lock-error' }

export const billEntryDraftPointerKey = 'el-bill:bill-entry-draft-active'
export const billEntryDraftKeyFor = (sessionId: string): string
export const readBillEntryDraft = (now?: number): BillEntryDraft | null
export const writeBillEntryDraft = (
  rows: ManualBillDraftRow[],
  expectedRevision?: number,
  now?: number,
): Promise<BillDraftWriteResult>
export const removeBillEntryDraft = (): Promise<boolean>
export const cleanupExpiredBillEntryDraft = (now?: number): Promise<boolean>
```

- Modify `src/lib/storage.ts` to export:

```ts
export const runWithStorageMutationLock = async <T>(
  callback: () => T | Promise<T>,
): Promise<T>
```

All existing snapshot writes must continue to call this same function.

- [ ] **Step 1: Write failing draft lifecycle tests**

Define the same complete `makeDraft` helper from Task 2 in this test file; task
workers must not import test code from another module.

```ts
it('restores a bounded draft without extending expiry on edits', async () => {
  const first = await writeBillEntryDraft([makeDraft()], undefined, 1_000)
  expect(first.ok).toBe(true)
  if (!first.ok) return
  const edited = await writeBillEntryDraft(
    [{ ...makeDraft(), usageKwh: '123' }],
    first.draft.revision,
    2_000,
  )
  expect(edited.ok).toBe(true)
  if (!edited.ok) return
  expect(edited.draft.createdAt).toBe(first.draft.createdAt)
  expect(edited.draft.expiresAt).toBe(first.draft.expiresAt)
})

it('physically deletes an expired draft', async () => {
  await writeBillEntryDraft([makeDraft()], undefined, 1_000)
  expect(await cleanupExpiredBillEntryDraft(86_401_001)).toBe(true)
  expect(readBillEntryDraft(86_401_001)).toBeNull()
  expect(
    Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
      .some((key) => key?.startsWith('el-bill:bill-entry-draft:')),
  ).toBe(false)
})

it('rejects stale concurrent revisions', async () => {
  const first = await writeBillEntryDraft([makeDraft()], undefined, 1_000)
  expect(first.ok).toBe(true)
  await expect(writeBillEntryDraft([makeDraft()], 99, 2_000)).resolves.toEqual({
    ok: false,
    reason: 'stale',
  })
})
```

- [ ] **Step 2: Run tests and verify failure**

```bash
npx vitest run src/lib/billDraftStorage.test.ts
```

Expected: FAIL because draft storage functions do not exist.

- [ ] **Step 3: Export and reuse the existing mutation lock**

Rename the private `withStorageMutationLock` export without changing its
behavior. Update snapshot functions to call `runWithStorageMutationLock`.
Run `src/lib/storageLock.test.ts` immediately to prove snapshot locking did not
regress.

- [ ] **Step 4: Implement strict draft serialization**

Use the active data-session ID when one exists. Otherwise create a
`draft-${crypto.randomUUID()}` session and save its ID in the draft pointer.
Validate every property, enforce at most 36 rows, enforce unique row IDs, and
enforce `0 < expiresAt - createdAt <= 86_400_000`. Parse failure must delete the
malformed draft and pointer.

- [ ] **Step 5: Implement revision-safe writes and physical cleanup**

Inside `runWithStorageMutationLock`, compare `expectedRevision`, preserve the
original timestamps, write one complete JSON value, read it back, and only then
return success. Cleanup removes both the draft key and pointer. Storage failures
must not erase a prior valid draft.

- [ ] **Step 6: Run focused tests**

```bash
npx vitest run src/lib/billDraftStorage.test.ts src/lib/storageLock.test.ts src/lib/storageSnapshot.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/billDraftStorage.ts src/lib/billDraftStorage.test.ts src/lib/storage.ts src/lib/storageLock.test.ts
git commit -m "feat: retain manual bill drafts for 24 hours"
```

---

### Task 4: Refactor bill entry into a tabbed input center

**Files:**
- Create: `src/components/bills/FileBillInput.tsx`
- Create: `src/components/bills/FileBillInput.test.tsx`
- Create: `src/components/bills/BillInputPreview.tsx`
- Create: `src/components/bills/BillInputPreview.test.tsx`
- Modify: `src/components/bills/BillUpload.tsx`
- Modify: `src/components/bills/BillUpload.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `buildBillColumnMapping`, current file parser, current recognition
  summary, current `BillTable`.
- Produces:

```ts
export type BillInputMode = 'file' | 'paste' | 'manual'

export interface BillInputCandidate {
  origin: Exclude<BillDataOrigin, 'sample'>
  bills: MonthlyBill[]
  sourceLabel: string
}

interface BillUploadProps {
  bills: MonthlyBill[]
  profile: SchoolProfile
  ratePlans: RatePlan[]
  onBillsChange: (
    bills: MonthlyBill[],
    origin: Exclude<BillDataOrigin, 'sample'>,
  ) => Promise<boolean>
  onOpenGuide: (sectionId: string) => void
}
```

- [ ] **Step 1: Add failing tab and file-regression tests**

```tsx
render(<BillUpload {...props} />)
expect(screen.getByRole('tab', { name: '파일 업로드' })).toHaveAttribute(
  'aria-selected',
  'true',
)
await user.click(screen.getByRole('tab', { name: '표 붙여넣기' }))
expect(screen.getByRole('tabpanel')).toHaveAccessibleName('표 붙여넣기')
await user.keyboard('{ArrowRight}')
expect(screen.getByRole('tab', { name: '직접 입력' })).toHaveFocus()
```

Keep the existing synthetic workbook test and assert the callback receives
`(bills, 'uploaded')`.

- [ ] **Step 2: Run component tests and verify failure**

```bash
npx vitest run src/components/bills/BillUpload.test.tsx src/components/bills/FileBillInput.test.tsx
```

Expected: FAIL because tabs and extracted file component do not exist.

- [ ] **Step 3: Extract current file behavior without changing copy or logic**

Move file-selection, drop, recognition, sheet selection, mapping, and current
preview JSX into `FileBillInput`. Keep its current error messages and parser
limits. Its success callback emits a `BillInputCandidate` with
`origin: 'uploaded'`.

- [ ] **Step 4: Add the accessible tab shell**

Use one stable-height tab bar with icons and the ARIA tab pattern. ArrowLeft,
ArrowRight, Home, and End move focus and selection. The parent preserves child
state while tabs switch by keeping each panel mounted and toggling visibility;
hidden panels must have `hidden` and not remain keyboard-focusable.

- [ ] **Step 5: Add a shared candidate preview**

`BillInputPreview` displays source label, row count, period range, required and
observed optional fields, period issues, and the current/applied-data
distinction. Disable `이 데이터로 분석 시작` if the candidate is empty, has
period issues, or lacks an exact rate-plan context.

- [ ] **Step 6: Connect origin-aware save**

On confirmation call `onBillsChange(candidate.bills, candidate.origin)`.
Preserve current data after any save failure and show the existing storage
failure copy.

- [ ] **Step 7: Run focused tests**

```bash
npx vitest run src/components/bills/BillUpload.test.tsx src/components/bills/FileBillInput.test.tsx src/components/bills/BillInputPreview.test.tsx src/App.atomic-storage.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/bills/FileBillInput.tsx src/components/bills/FileBillInput.test.tsx src/components/bills/BillInputPreview.tsx src/components/bills/BillInputPreview.test.tsx src/components/bills/BillUpload.tsx src/components/bills/BillUpload.test.tsx src/App.tsx src/styles.css
git commit -m "refactor: add tabbed bill input center"
```

---

### Task 5: Pasted table and spreadsheet-style manual entry

**Files:**
- Create: `src/components/bills/PastedBillInput.tsx`
- Create: `src/components/bills/PastedBillInput.test.tsx`
- Create: `src/components/bills/ManualBillInput.tsx`
- Create: `src/components/bills/ManualBillInput.test.tsx`
- Modify: `src/components/bills/BillUpload.tsx`
- Modify: `src/components/bills/BillUpload.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: Task 2 normalization, Task 3 draft storage, Task 4 candidate preview.
- Produces:

```ts
interface PersonalBillInputProps {
  importContext?: BillImportContext
  onCandidateChange: (candidate: BillInputCandidate | null) => void
  onOpenGuide: (sectionId: string) => void
}
```

- [ ] **Step 1: Write failing pasted-input tests**

```tsx
await user.paste(
  '연도\\t월\\t사용량(kWh)\\t총 전기요금(원)\\n2026\\t7\\t48365\\t7138790',
)
expect(screen.getByText('1개월을 인식했습니다.')).toBeVisible()
expect(onCandidateChange).toHaveBeenLastCalledWith(
  expect.objectContaining({ origin: 'pasted' }),
)
```

Also test that parsing failure retains the pasted text and that missing headers
opens the existing column-mapping controls instead of silently guessing.

- [ ] **Step 2: Write failing manual-entry tests**

Cover:

```tsx
await user.click(screen.getByRole('button', { name: '최근 12개월 입력행 생성' }))
expect(screen.getAllByLabelText(/사용량\\(kWh\\)/)).toHaveLength(12)

await user.type(screen.getByLabelText('2026-07 사용량(kWh)'), '48,365 kWh')
await user.type(screen.getByLabelText('2026-07 총 전기요금(원)'), '7,138,790원')
expect(onCandidateChange).toHaveBeenLastCalledWith(
  expect.objectContaining({ origin: 'manual' }),
)
```

Add tests for detail-column toggle, apply-to-all power, multi-cell paste,
duplicate period errors, first-error focus, row cap, and draft restoration.

- [ ] **Step 3: Run tests and verify failure**

```bash
npx vitest run src/components/bills/PastedBillInput.test.tsx src/components/bills/ManualBillInput.test.tsx
```

Expected: FAIL because the components do not exist.

- [ ] **Step 4: Implement pasted input**

Keep the textarea value until the user explicitly clears it. Parse on
`붙여넣은 표 확인`, show recognized headers and rows, allow mapping correction,
then emit only a fully valid candidate. Limit input text to 200,000 characters
before parsing and rows to 36 after parsing.

- [ ] **Step 5: Implement the basic manual grid**

Default the last-month control to the current local `YYYY-MM`, but do not
generate rows until the user clicks. Use text inputs with `inputMode="decimal"`
so unit-bearing pasted strings are accepted and normalized. Add stable row IDs,
row add/delete, 12/36 generation, full reset confirmation, and per-cell issues.

- [ ] **Step 6: Implement details and keyboard behavior**

Keep the basic columns visible. Add the approved optional columns in a
horizontally scrollable region. Maintain a `Map<rowId-field, HTMLInputElement>`
for Tab/Shift+Tab/Enter/arrow navigation. On multi-cell paste, call
`applyMatrixToDraftRows` beginning at the focused cell. Do not intercept
modifier shortcuts or screen-reader navigation keys.

- [ ] **Step 7: Integrate expiring drafts**

Read the draft on mount, debounce revision-safe writes by 300ms after edits,
show `입력 초안이 이 브라우저에 최대 24시간 보관됩니다`, and retain UI input
if persistence fails. On successful applied-data save, call
`removeBillEntryDraft`; on full reset, remove the draft before clearing rows.

- [ ] **Step 8: Integrate both panels into BillUpload**

Render the new components in their panels. Candidates use the same Task 4
preview and save boundary. Add direct links to guide anchors
`paste-input` and `manual-input`.

- [ ] **Step 9: Run focused tests**

```bash
npx vitest run src/lib/billInput.test.ts src/lib/billDraftStorage.test.ts src/components/bills/PastedBillInput.test.tsx src/components/bills/ManualBillInput.test.tsx src/components/bills/BillUpload.test.tsx
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/components/bills/PastedBillInput.tsx src/components/bills/PastedBillInput.test.tsx src/components/bills/ManualBillInput.tsx src/components/bills/ManualBillInput.test.tsx src/components/bills/BillUpload.tsx src/components/bills/BillUpload.test.tsx src/styles.css
git commit -m "feat: add paste and quick manual bill entry"
```

---

### Task 6: One-shot newest file selection

**Files:**
- Create: `src/lib/localDirectoryImport.ts`
- Create: `src/lib/localDirectoryImport.test.ts`
- Create: `src/types/file-system-access.d.ts`
- Modify: `src/components/bills/FileBillInput.tsx`
- Modify: `src/components/bills/FileBillInput.test.tsx`

**Interfaces:**
- Produces:

```ts
export const supportsDirectoryPicker = (): boolean

export type DirectoryImportResult =
  | { ok: true; file: File }
  | { ok: false; reason: 'unsupported' | 'cancelled' | 'no-supported-file' | 'read-error' }

export const selectNewestSupportedFile = (
  directory: FileSystemDirectoryHandle,
): Promise<DirectoryImportResult>

export const chooseNewestSupportedFile = (): Promise<DirectoryImportResult>
```

- [ ] **Step 1: Write failing directory helper tests**

Use fake directory handles with three files and assert the newest valid
`.xlsx`, `.csv`, or Power Planner HTML `.xls` is returned. Cover nested
directories being ignored, invalid magic bytes being skipped, permission
cancellation, and no supported file.

- [ ] **Step 2: Run tests and verify failure**

```bash
npx vitest run src/lib/localDirectoryImport.test.ts
```

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement feature detection and one-shot selection**

Call `showDirectoryPicker({ mode: 'read' })` only from the button event. Iterate
only top-level file handles, read metadata, order newest first, and run
`validateUploadFile` before returning. Do not persist the directory handle and
do not scan automatically.

- [ ] **Step 4: Add the FileBillInput control**

Show `다운로드 폴더에서 최신 파일 찾기` when supported. Otherwise show the
non-blocking text `Chrome 또는 Edge에서는 다운로드 폴더에서 최신 파일을 찾을 수 있습니다.`
Keep the ordinary file chooser primary. Cancellation returns to the unchanged
screen without an error banner.

- [ ] **Step 5: Run focused tests**

```bash
npx vitest run src/lib/localDirectoryImport.test.ts src/components/bills/FileBillInput.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/localDirectoryImport.ts src/lib/localDirectoryImport.test.ts src/types/file-system-access.d.ts src/components/bills/FileBillInput.tsx src/components/bills/FileBillInput.test.tsx
git commit -m "feat: find the newest local bill export"
```

---

### Task 7: Usage guide, GPT prompt, and CSV template

**Files:**
- Create: `src/content/usageGuide.ts`
- Create: `src/content/usageGuide.test.ts`
- Create: `src/components/guide/UsageGuide.tsx`
- Create: `src/components/guide/UsageGuide.test.tsx`
- Modify: `src/types.ts`
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/components/bills/BillUpload.tsx`
- Modify: `src/styles.css`
- Modify: `README.md`
- Modify: `docs/calculation-notes.md`

**Interfaces:**
- Produces:

```ts
export const gptBillConversionPrompt: string
export const externalAiPrivacyWarning: string
export const usageGuideSections: readonly {
  id: string
  title: string
}[]
```

- Extends:

```ts
export type ViewKey =
  | 'dashboard'
  | 'diagnosis'
  | 'school'
  | 'bills'
  | 'powerPlanner'
  | 'rates'
  | 'peak'
  | 'docs'
  | 'settings'
  | 'guide'
```

- [ ] **Step 1: Write failing content-contract tests**

Assert the prompt includes every exact CSV header, `원본에 없는 값은 계산하거나
추측하지 마세요`, duplicate handling, optional blanks, and exclusion of school
name, customer number, contact details, and payment data. Assert the warning
states that the app's 24-hour deletion does not apply to external AI uploads.

- [ ] **Step 2: Write failing guide component tests**

Test:

```tsx
expect(screen.getByRole('heading', { name: '사용 방법 안내' })).toBeVisible()
await user.click(screen.getByRole('button', { name: 'GPT 변환 프롬프트 복사' }))
expect(navigator.clipboard.writeText).toHaveBeenCalledWith(gptBillConversionPrompt)
await user.click(screen.getByRole('button', { name: '표준 CSV 양식 다운로드' }))
expect(screen.getByRole('status')).toHaveTextContent('다운로드를 시작했습니다')
```

Also verify the guide contains file, paste, manual, Power Planner, diagnosis,
peak, documents, security, 24-hour deletion, EDS limitation, internal estimate,
and one-year change caution sections.

- [ ] **Step 3: Run tests and verify failure**

```bash
npx vitest run src/content/usageGuide.test.ts src/components/guide/UsageGuide.test.tsx
```

Expected: FAIL because guide content and component do not exist.

- [ ] **Step 4: Add immutable guide content**

Copy the exact approved prompt from
`docs/superpowers/specs/2026-07-27-personal-data-entry-and-guide-design.md`.
Do not shorten its validation or privacy rules. Export it from one module so
tests and the copy button use the same string.

- [ ] **Step 5: Implement the guide page**

Use unframed sections with a sticky section index on desktop and a compact
native select on mobile. Use numbered steps for the primary workflow. Include
copy and download buttons with status feedback. Do not state that ChatGPT or
another external service inherits this app's retention policy.

- [ ] **Step 6: Add navigation and anchored help**

Add `사용 안내` with `BookOpen` to Sidebar. In App, hold a `guideSectionId`
state and implement:

```ts
const openGuide = (sectionId: string) => {
  setGuideSectionId(sectionId)
  setActiveView('guide')
}
```

`UsageGuide` scrolls to and focuses the requested section heading after mount.
Pass `openGuide` into BillUpload. Add `도움말` links from all three input tabs.

- [ ] **Step 7: Update reader documentation**

README must describe the three input methods, local folder limitations, GPT
privacy boundary, and no personal EDS automatic integration. Calculation notes
must state that pasted/manual origin uses the same calculation engine but does
not become a verified KEPCO original.

- [ ] **Step 8: Run focused tests**

```bash
npx vitest run src/content/usageGuide.test.ts src/components/guide/UsageGuide.test.tsx src/App.test.tsx src/components/bills/BillUpload.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/content/usageGuide.ts src/content/usageGuide.test.ts src/components/guide/UsageGuide.tsx src/components/guide/UsageGuide.test.tsx src/types.ts src/components/layout/Sidebar.tsx src/App.tsx src/App.test.tsx src/components/bills/BillUpload.tsx src/styles.css README.md docs/calculation-notes.md
git commit -m "feat: add personal-use guide and GPT conversion prompt"
```

---

### Task 8: End-to-end verification, production test support, and deployment

**Files:**
- Modify: `e2e/auto-diagnosis.e2e.ts`
- Modify: `playwright.config.ts`
- Modify: `docs/deployment.md`
- Modify only if a failing test exposes a defect: files owned by Tasks 1-7

**Interfaces:**
- Produces environment-controlled Playwright base URL:

```ts
const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL
const baseURL = externalBaseURL ?? 'http://127.0.0.1:4173'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['html'], ['list']] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(useLocalChrome ? { channel: 'chrome' } : {}),
      },
    },
  ],
  webServer: externalBaseURL
    ? undefined
    : {
        command:
          'npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
        url: baseURL,
        reuseExistingServer: false,
        timeout: 180_000,
      },
})
```

- [ ] **Step 1: Add failing E2E coverage**

Add tests that:

1. Paste 12 valid monthly rows, apply them, and confirm
   `고지서: 표 붙여넣기` plus automatic diagnosis.
2. Generate 12 manual rows, fill them with multi-cell paste, reload before
   applying, confirm draft restoration, apply, and confirm
   `고지서: 직접 입력`.
3. Open Usage Guide, copy the GPT prompt, download the template, and verify its
   UTF-8 BOM and exact header.
4. Set a draft expiry in localStorage to the past, reload, and verify the draft
   key and pointer are physically removed.
5. Exercise input tabs and guide navigation at `390x844` without overlap.

- [ ] **Step 2: Run the new E2E subset and verify failure**

```bash
npx playwright test --project=chromium -g "pasted bill|manual bill|usage guide|expired bill draft|mobile personal input"
```

Expected: at least one new test FAIL before final integration fixes.

- [ ] **Step 3: Fix only defects exposed by E2E**

Keep fixes inside the owning module. Do not relax validation, retention, or
privacy requirements to make tests pass. Add a focused unit test before each
behavioral fix. Use these ownership pairs:

- Manual entry: `src/components/bills/ManualBillInput.test.tsx` and
  `src/components/bills/ManualBillInput.tsx`.
- Pasted input: `src/components/bills/PastedBillInput.test.tsx` and
  `src/components/bills/PastedBillInput.tsx`.
- Guide behavior: `src/components/guide/UsageGuide.test.tsx` and
  `src/components/guide/UsageGuide.tsx`.
- Draft expiry: `src/lib/billDraftStorage.test.ts` and
  `src/lib/billDraftStorage.ts`.

After focused tests pass, commit only the ownership pairs that changed:

```bash
git add src/components/bills/ManualBillInput.test.tsx src/components/bills/ManualBillInput.tsx src/components/bills/PastedBillInput.test.tsx src/components/bills/PastedBillInput.tsx src/components/guide/UsageGuide.test.tsx src/components/guide/UsageGuide.tsx src/lib/billDraftStorage.test.ts src/lib/billDraftStorage.ts
git commit -m "fix: preserve personal input workflow behavior"
```

- [ ] **Step 4: Add external production URL support**

Implement the exact `PLAYWRIGHT_BASE_URL` branch above. Add no credentials and
start no local web server when the variable is set.

- [ ] **Step 5: Run the complete local quality gate**

Run in order:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm run test:e2e
npm audit --omit=dev
```

Expected:

- Typecheck, lint, unit tests, build, bundle budget, and all Playwright tests PASS.
- Audit output is reviewed. Do not claim zero findings if ExcelJS transitive
  Node-only findings remain; record reachability and current browser-only use.

- [ ] **Step 6: Update deployment runbook and commit**

Document the new smoke cases in `docs/deployment.md`, then commit:

```bash
git add e2e/auto-diagnosis.e2e.ts playwright.config.ts docs/deployment.md
git commit -m "test: verify personal bill entry workflows"
```

- [ ] **Step 7: Push the implementation branch and main after review**

```bash
git push -u origin codex/personal-data-entry-guide
git -C /Users/mac-mini/Documents/전기요금 fetch origin
git -C /Users/mac-mini/Documents/전기요금 merge --ff-only codex/personal-data-entry-guide
git push origin main
```

Expected: the feature branch is published, local `main` fast-forwards to the
reviewed commit, and `origin/main` receives that same commit. If fast-forward
fails, stop and reconcile new main commits in the feature worktree before
retrying; do not force-push.

- [ ] **Step 8: Build and atomically deploy to NAS**

Run a fresh build from reviewed `main`, then:

```bash
npm run build
STAMP=$(date +%Y%m%d-%H%M%S)
NEXT="/volume1/docker/el-bill/site-next-$STAMP"
BACKUP="/volume1/docker/el-bill/backups/site-$STAMP"
ssh ds925-home "sudo -n mkdir -p '$NEXT' /volume1/docker/el-bill/backups"
COPYFILE_DISABLE=1 tar -cf - -C dist . | ssh ds925-home "sudo -n tar -xf - -C '$NEXT'"
(cd dist && find . -type f -print0 | sort -z | xargs -0 shasum -a 256) > /tmp/el-bill-local.sha256
ssh ds925-home "cd '$NEXT' && sudo -n find . -type f -name '._*' -delete && sudo -n find . -type f -print0 | sort -z | sudo -n xargs -0 sha256sum" > /tmp/el-bill-nas.sha256
diff -u /tmp/el-bill-local.sha256 /tmp/el-bill-nas.sha256
ssh ds925-home "test ! -e '$BACKUP' && sudo -n chown -R http:http '$NEXT' && sudo -n mv /volume1/docker/el-bill/site '$BACKUP' && sudo -n mv '$NEXT' /volume1/docker/el-bill/site"
```

The `diff` must produce no output before the switch command runs. If manifest
comparison fails, run `ssh ds925-home "sudo -n rm -rf '$NEXT'"` and keep the
current production directory unchanged.

- [ ] **Step 9: Run production smoke**

```bash
curl -fsS -D - https://el-bill.h19h19.com/ -o /tmp/el-bill-index.html
PLAYWRIGHT_BASE_URL=https://el-bill.h19h19.com/ npx playwright test --project=chromium -g "pasted bill|manual bill|usage guide|mobile personal input"
```

Verify:

- Public HTML references the newly built hashed entry.
- HTML and entry asset return HTTP 200.
- `cache-control: no-store` and `cf-cache-status: DYNAMIC` remain.
- Browser console and page errors are empty.
- Pasted and manual diagnosis work.
- Guide prompt copy and template download work.
- Mobile navigation remains usable.

If production smoke fails, restore the exact `$BACKUP` directory atomically,
diagnose locally, and redeploy only after the complete gate passes again.

- [ ] **Step 10: Record completion**

Update the plan checklist or the active execution ledger with commit SHA,
test counts, deployed entry asset, production smoke results, and backup path.
