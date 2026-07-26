# MVP Data Integrity and Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent misleading diagnoses, remove re-identification risk, enforce a real 24-hour deletion session, and replace the vulnerable spreadsheet parser without removing the existing MVP workflow.

**Architecture:** Normalize every bill to a calendar `year/month`, validate distinct consecutive periods before diagnosis, and carry explicit provenance and observed-field metadata from upload through recommendation and document gates. Use one shared storage-session expiry for all user data, keep PowerPlanner enrichment separate from bill provenance, and migrate `.xlsx` parsing to ExcelJS while retaining the existing local CSV and PowerPlanner HTML-`.xls` parsers.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Vitest, Testing Library, Playwright, ExcelJS, JSZip, html2pdf.js

## Global Constraints

- Preserve the existing dashboard, upload, automatic diagnosis, tariff comparison, peak management, and document package features.
- Do not add KEPCO account login, crawling, unofficial API calls, or server-side file upload.
- Parse uploaded files only in the browser and retain the existing 10 MB and 10,000-row limits.
- Do not publish a real school name, customer number, address, contact, or source-specific monthly billing history.
- Keep the “internal diagnostic estimate, not an official bill calculator” notice.
- Keep the one-change-per-year caution in every recommendation and generated document.
- Block change-application documents unless 12 distinct consecutive calendar months are present and the recommended plan is an exact contract/voltage match.
- Treat official-form visual redesign as a separate plan; this plan only fixes document data binding.
- Complete each task with red-green TDD and an independent commit.

---

### Task 1: Canonical Billing Period Validation

**Files:**
- Create: `src/lib/billPeriods.ts`
- Create: `src/lib/billPeriods.test.ts`
- Modify: `src/lib/calculations.ts`
- Modify: `src/lib/diagnosis.ts`
- Modify: `src/types.ts`
- Test: `src/lib/diagnosis.test.ts`

**Interfaces:**
- Produces: `validateBillPeriods(bills: MonthlyBill[], requiredMonths?: number): BillPeriodValidation`
- Produces: `getCalendarMonthIndex(year: number, month: number): number`
- Produces: `BillPeriodValidation` with `normalizedBills`, `distinctMonthCount`, `recentConsecutiveBills`, `issues`, and `hasRequiredConsecutiveMonths`
- Consumes: all diagnosis and three-year calculation paths use only `normalizedBills`

- [ ] **Step 1: Write failing calendar-order and continuity tests**

```ts
it('orders December before the following January', () => {
  const result = validateBillPeriods([
    bill(2026, 1),
    bill(2025, 12),
  ])
  expect(result.normalizedBills.map(({ year, month }) => `${year}-${month}`))
    .toEqual(['2025-12', '2026-1'])
})

it('does not count duplicate or gapped rows as 12 consecutive months', () => {
  const duplicate = Array.from({ length: 12 }, () => bill(2026, 1))
  const result = validateBillPeriods(duplicate, 12)
  expect(result.distinctMonthCount).toBe(1)
  expect(result.hasRequiredConsecutiveMonths).toBe(false)
  expect(result.issues.map((issue) => issue.code)).toContain('duplicate-period')
})
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm run test -- src/lib/billPeriods.test.ts`

Expected: FAIL because `validateBillPeriods` does not exist.

- [ ] **Step 3: Add the period validation types and implementation**

```ts
export type BillPeriodIssueCode =
  | 'invalid-period'
  | 'duplicate-period'
  | 'missing-period'

export interface BillPeriodIssue {
  code: BillPeriodIssueCode
  period?: string
  message: string
}

export interface BillPeriodValidation {
  normalizedBills: MonthlyBill[]
  distinctMonthCount: number
  recentConsecutiveBills: MonthlyBill[]
  hasRequiredConsecutiveMonths: boolean
  issues: BillPeriodIssue[]
}
```

Use `year * 12 + (month - 1)` for ordering. Reject month values outside `1..12`, report duplicate keys, and build the most recent backwards-contiguous run without silently merging duplicate rows.

- [ ] **Step 4: Make diagnosis and document gates consume the validation result**

Replace row-count checks such as `getRecentBills(bills, 12).length >= 12` with `validation.hasRequiredConsecutiveMonths`. Set `recognizedMonths` from `distinctMonthCount`, include period issues in `missingDataNotes`, and calculate annual/three-year values from deduplicated calendar-ordered rows.

- [ ] **Step 5: Verify focused and full tests**

Run: `npm run test -- src/lib/billPeriods.test.ts src/lib/diagnosis.test.ts src/lib/calculations.test.ts`

Expected: all focused tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/billPeriods.ts src/lib/billPeriods.test.ts src/lib/calculations.ts src/lib/diagnosis.ts src/lib/diagnosis.test.ts src/lib/calculations.test.ts src/types.ts
git commit -m "fix: validate consecutive billing periods"
```

---

### Task 2: Replace Re-identifiable Sample Data

**Files:**
- Modify: `src/data/sampleBills.ts`
- Modify: `src/data/sampleBills.test.ts`
- Modify: `README.md`
- Modify: `docs/calculation-notes.md`

**Interfaces:**
- Produces: deterministic synthetic `sampleBills` with 36 distinct consecutive calendar months
- Consumes: Task 1 period validation

- [ ] **Step 1: Write failing sample privacy and continuity tests**

```ts
it('uses 36 consecutive synthetic calendar months', () => {
  const validation = validateBillPeriods(sampleBills, 36)
  expect(validation.distinctMonthCount).toBe(36)
  expect(validation.recentConsecutiveBills).toHaveLength(36)
})

it('contains no source-specific note or direct identifier', () => {
  expect(JSON.stringify(sampleBills)).not.toMatch(/등촌|8616|9136/)
  expect(defaultSchoolProfile.customerNumber).toBe('**********')
})
```

- [ ] **Step 2: Run and verify RED**

Run: `npm run test -- src/data/sampleBills.test.ts`

Expected: FAIL because the current data contains source-derived values and non-calendar academic-year periods.

- [ ] **Step 3: Replace the sample with a deterministic synthetic generator**

Generate periods from `2023-08` through `2026-07`. Use deterministic season-aware formulas instead of copied bill rows:

```ts
const usageFor = (year: number, month: number, index: number) =>
  Math.round(
    28_000 +
      (month >= 6 && month <= 8 ? 13_000 : 0) +
      ([12, 1, 2].includes(month) ? 17_000 : 0) +
      (index % 5) * 1_350 +
      (year - 2023) * 420,
  )
```

Derive component charges from the documented sample tariff assumptions, round totals, and label every row `합성 시연 데이터`. Do not preserve source-school monthly values.

- [ ] **Step 4: Remove source-school references from current tracked documentation**

Rewrite the attachment section to describe “사용자가 제공한 익명화 대상 자료” without school names or document numbers.

Run: `rg -n "등촌|8616|9136" README.md docs src`

Expected: no output.

- [ ] **Step 5: Document Git-history handling**

Add a README privacy note: current tracked content is anonymized, but rewriting already-pushed Git history requires a separate explicit approval because it changes commit hashes for collaborators.

- [ ] **Step 6: Verify and commit**

Run: `npm run test -- src/data/sampleBills.test.ts src/lib/diagnosis.test.ts`

```bash
git add src/data/sampleBills.ts src/data/sampleBills.test.ts README.md docs/calculation-notes.md
git commit -m "fix: replace source-derived sample data"
```

---

### Task 3: Track Upload Provenance and Observed Fields

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/excel.ts`
- Modify: `src/lib/excel.test.ts`
- Modify: `src/lib/diagnosis.ts`
- Modify: `src/lib/diagnosis.test.ts`
- Modify: `src/components/bills/BillUpload.tsx`
- Modify: `src/data/sampleBills.ts`

**Interfaces:**
- Produces: `BillImportContext`
- Produces: `MonthlyBill.observedFields: MonthlyBillObservedField[]`
- Changes: `parseWorkbook(file, context?)`
- Changes: `mapRowsToBills(rows, mapping, context)`

- [ ] **Step 1: Write failing tests for missing optional columns**

```ts
it('uses profile defaults without pretending they were observed', () => {
  const [bill] = mapRowsToBills(rowsWithRequiredColumnsOnly, mapping, {
    appliedPowerKw: 620,
    currentPlan,
  })
  expect(bill.appliedPowerKw).toBe(620)
  expect(bill.maxDemandKw).toBe(0)
  expect(bill.observedFields).not.toContain('appliedPowerKw')
  expect(bill.observedFields).not.toContain('maxDemandKw')
})

it('does not copy applied power into maximum demand', () => {
  expect(powerPlannerBill.maxDemandKw).toBe(0)
})
```

- [ ] **Step 2: Run and verify RED**

Run: `npm run test -- src/lib/excel.test.ts src/lib/diagnosis.test.ts`

Expected: FAIL on the current `497`, `6370`, `82.1`, and applied-power-as-demand fallbacks.

- [ ] **Step 3: Define import context and observed-field metadata**

```ts
export interface BillImportContext {
  appliedPowerKw: number
  currentPlan: RatePlan
}

export type MonthlyBillObservedField =
  | 'year'
  | 'month'
  | 'usageKwh'
  | 'totalBillWon'
  | 'appliedPowerKw'
  | 'maxDemandKw'
  | 'baseChargeWon'
  | 'energyChargeWon'
  | 'powerFactorChargeWon'
  | 'climateChargeWon'
  | 'fuelAdjustmentWon'
  | 'vatWon'
  | 'fundWon'
```

Always record required mapped fields. Use `context.appliedPowerKw` as a calculation fallback when the column is absent, but do not mark it observed. Leave missing `maxDemandKw` at `0`. Derive optional charge values only from the active plan, never school-specific constants.

Populate every truly generated field in the synthetic sample's `observedFields` so sample confidence remains deterministic after the type change.

- [ ] **Step 4: Pass the active profile and exact current plan into BillUpload**

Build one `BillImportContext` from `profile.appliedPowerKw` and the validated current rate plan. Use it for auto-parsed rows and manual mappings.

- [ ] **Step 5: Make confidence depend on observed fields**

`데이터 충분` requires 36 consecutive months and observed positive `maxDemandKw` for every row. Recognition percentage must not award optional-column points for inferred values.

- [ ] **Step 6: Verify and commit**

Run: `npm run test -- src/lib/excel.test.ts src/lib/diagnosis.test.ts`

```bash
git add src/types.ts src/lib/excel.ts src/lib/excel.test.ts src/lib/diagnosis.ts src/lib/diagnosis.test.ts src/components/bills/BillUpload.tsx
git commit -m "fix: remove school-specific import defaults"
```

---

### Task 4: Separate Bill and PowerPlanner Provenance

**Files:**
- Modify: `src/types.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/dashboard/Dashboard.tsx`
- Modify: `src/components/diagnosis/AutoDiagnosis.tsx`
- Modify: `src/components/powerPlanner/PowerPlannerUpload.tsx`
- Modify: `e2e/auto-diagnosis.e2e.ts`

**Interfaces:**
- Replaces: `DataMode`
- Produces: `DataProvenance` with `bills: 'sample' | 'uploaded'` and `powerPlanner: 'none' | 'sample' | 'uploaded'`
- Rule: PowerPlanner data enriches peak analysis but never changes bill-upload status or document eligibility
- Changes: `onDataSourceChange(source, origin: 'none' | 'sample' | 'uploaded')`

- [ ] **Step 1: Add a failing PowerPlanner-only E2E scenario**

```ts
test('PowerPlanner-only upload does not claim uploaded-bill diagnosis', async ({ page }) => {
  await resetToSample(page)
  await uploadPowerPlannerCsv(page, powerPlannerCsv)
  await expect(page.getByText('고지서: 시연 샘플')).toBeVisible()
  await expect(page.getByText('파워플래너: 사용자 업로드')).toBeVisible()
  await expect(page.getByRole('button', { name: '전체 다운로드 (ZIP)' })).toBeDisabled()
})
```

- [ ] **Step 2: Run and verify RED**

Run: `npm run test:e2e -- --grep "PowerPlanner-only"`

Expected: FAIL because `applyPowerPlannerAndOpenDiagnosis` currently sets the whole session to uploaded.

- [ ] **Step 3: Introduce explicit provenance**

```ts
export interface DataProvenance {
  bills: 'sample' | 'uploaded'
  powerPlanner: 'none' | 'sample' | 'uploaded'
}
```

Store provenance under `el-bill:data-provenance`. Bill upload changes only `bills`; PowerPlanner upload changes only `powerPlanner`. Derive dashboard and notice labels from both fields.

Pass the origin explicitly from `PowerPlannerUpload`: file mapping uses `uploaded`, the demonstration button uses `sample`, and reset uses `none`. Do not infer provenance from filenames or record IDs.

- [ ] **Step 4: Block real application documents for sample-bill diagnoses**

Add `billsAreUserUploaded` to diagnosis input and require it in `canGenerateChangeDocuments`. Keep PDF previews available as demonstration, but disable copy/download/ZIP and state “사용자 고지서 업로드 후 생성 가능”.

- [ ] **Step 5: Verify and commit**

Run: `npm run test:e2e -- --grep "PowerPlanner-only|automatic diagnosis"`

```bash
git add src/types.ts src/App.tsx src/components/dashboard/Dashboard.tsx src/components/diagnosis/AutoDiagnosis.tsx src/components/powerPlanner/PowerPlannerUpload.tsx e2e/auto-diagnosis.e2e.ts
git commit -m "fix: separate bill and PowerPlanner provenance"
```

---

### Task 5: Exact Current Plan and Defensive Input Validation

**Files:**
- Modify: `src/lib/diagnosis.ts`
- Modify: `src/lib/diagnosis.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/peak/PeakManager.tsx`
- Modify: `src/lib/peak.ts`
- Modify: `src/lib/peakOperations.test.ts`
- Modify: `src/components/docs/DocumentGenerator.tsx`
- Modify: `src/components/docs/DocumentGenerator.test.tsx`

**Interfaces:**
- Produces: `resolveCurrentPlan(profile, ratePlans): { plan: RatePlan; exact: boolean; issue?: string }`
- Produces: `sanitizeDownloadStem(value: string): string`
- Rule: invalid target peak is never classified as safe

- [ ] **Step 1: Write failing diagnosis, peak, and document-binding tests**

```ts
it('blocks diagnosis when the current plan is not an exact match', () => {
  const result = buildAutoDiagnosis({
    ...validInput,
    profile: { ...profile, currentPlan: '오타 요금제' },
  })
  expect(result.completed).toBe(false)
  expect(result.canGenerateChangeDocuments).toBe(false)
  expect(result.missingDataNotes).toContain('현재 요금제를 요금표에서 확인해 주세요.')
})

it('never reports a non-positive target as safe', () => {
  expect(getPeakRiskLevel(0, 400)).toBe('위험')
  expect(getPeakRiskLevel(-1, 400)).toBe('위험')
})

it('uses the configured display name in the masthead and ZIP name', () => {
  renderGenerator({ displaySchoolName: '테스트고등학교' })
  expect(screen.getAllByText('테스트고등학교').length).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Run and verify RED**

Run: `npm run test -- src/lib/diagnosis.test.ts src/lib/peakOperations.test.ts src/components/docs/DocumentGenerator.test.tsx`

- [ ] **Step 3: Replace free-text tariff fields with constrained selects**

Filter current-plan options by `contractType` and `voltageType`. When either parent field changes, select the first valid plan and display a clear blocking message if no valid plan exists.

- [ ] **Step 4: Add defensive library validation**

Return `exact: false` instead of silently treating the first matching plan as current. Force `추가 검토 필요`, `completed: false`, and document blocking when the match is inexact. In peak inputs, set `min={1}` and reject non-positive updates; return `위험` defensively for non-positive targets.

- [ ] **Step 5: Remove hard-coded document identity**

Pass `profile.displaySchoolName` into the masthead. Build the ZIP filename from `sanitizeDownloadStem(profile.displaySchoolName)` and fall back to `학교` after removing `/\:*?"<>|` and path separators.

- [ ] **Step 6: Verify and commit**

Run: `npm run test -- src/lib/diagnosis.test.ts src/lib/peakOperations.test.ts src/components/docs/DocumentGenerator.test.tsx`

```bash
git add src/lib/diagnosis.ts src/lib/diagnosis.test.ts src/App.tsx src/components/peak/PeakManager.tsx src/lib/peak.ts src/lib/peakOperations.test.ts src/components/docs/DocumentGenerator.tsx src/components/docs/DocumentGenerator.test.tsx
git commit -m "fix: validate plan peak and document inputs"
```

---

### Task 6: Shared 24-Hour Storage Session and Live Expiry

**Files:**
- Modify: `src/lib/storage.ts`
- Modify: `src/lib/storage.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/layout/TopNotice.tsx`
- Create: `src/App.test.tsx`

**Interfaces:**
- Produces: `createStorageSession(now?: number): StorageSession`
- Produces: `saveForSession(key, data, session)`
- Produces: `purgeStorageSession(keys, sessionKey)`
- Rule: each user upload starts one new shared 24-hour session; subsequent edits never extend it

- [ ] **Step 1: Write failing fake-timer tests**

```ts
it('starts a fresh 24-hour session when user data is uploaded', () => {
  vi.setSystemTime(new Date('2026-07-26T00:00:00Z'))
  const first = createStorageSession()
  vi.setSystemTime(new Date('2026-07-26T23:00:00Z'))
  const uploaded = createStorageSession()
  expect(Date.parse(uploaded.expiresAt) - Date.parse(uploaded.createdAt))
    .toBe(24 * 60 * 60 * 1000)
  expect(uploaded.expiresAt).not.toBe(first.expiresAt)
})

it('clears live user state when the shared session expires', async () => {
  vi.advanceTimersByTime(24 * 60 * 60 * 1000)
  expect(screen.getByText('시연 샘플', { exact: true })).toBeVisible()
  expect(localStorage.getItem('el-bill:bills')).toBeNull()
})
```

- [ ] **Step 2: Run and verify RED**

Run: `npm run test -- src/lib/storage.test.ts src/App.test.tsx`

- [ ] **Step 3: Implement one session metadata record**

```ts
export interface StorageSession {
  createdAt: string
  expiresAt: string
}

export const storageSessionKey = 'el-bill:storage-session'
```

All persisted keys reference the same session. New bill or PowerPlanner uploads call `startNewStorageSession`; ordinary profile/scenario edits reuse the current expiry.

- [ ] **Step 4: Enforce live expiry**

In `App`, schedule one timeout for `expiresAt - Date.now()`. On expiry, remove every storage key, clear PowerPlanner data, restore the synthetic sample, set provenance to sample/none, and show “24시간이 지나 시연 데이터가 삭제되었습니다.”

- [ ] **Step 5: Verify and commit**

Run: `npm run test -- src/lib/storage.test.ts src/App.test.tsx`

```bash
git add src/lib/storage.ts src/lib/storage.test.ts src/App.tsx src/components/layout/TopNotice.tsx src/App.test.tsx
git commit -m "fix: enforce shared live data expiry"
```

---

### Task 7: Replace the Vulnerable XLSX Parser

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/lib/excel.ts`
- Modify: `src/lib/excel.test.ts`
- Create: `e2e/fixtures/monthly-bills.xlsx`
- Modify: `README.md`
- Modify: `docs/upload-security-plan.md`

**Interfaces:**
- Replaces: npm `xlsx@0.18.5` with `exceljs`
- Preserves: `parseWorkbook(file, context?) => Promise<WorkbookParseResult>`
- Preserves: custom CSV and PowerPlanner HTML-`.xls` parsing paths

- [ ] **Step 1: Check in a synthetic real-workbook fixture**

Create `e2e/fixtures/monthly-bills.xlsx` containing 12 synthetic consecutive months and all required columns. It must contain no real school metadata.

- [ ] **Step 2: Replace the machine-specific skipped test**

```ts
it('parses the checked-in synthetic XLSX fixture', async () => {
  const buffer = await readFile('e2e/fixtures/monthly-bills.xlsx')
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  )
  const result = await parseWorkbook(arrayBuffer, importContext)
  expect(result.autoRows).toHaveLength(12)
  expect(result.autoRows[0].observedFields).toContain('totalBillWon')
})
```

Run: `npm run test -- src/lib/excel.test.ts`

Expected before fixture/parser work: FAIL or SKIP.

- [ ] **Step 3: Install ExcelJS and remove SheetJS**

Run:

```bash
npm uninstall xlsx
npm install exceljs
```

Use `new ExcelJS.Workbook().xlsx.load(buffer)` for `.xlsx`. Continue using the existing local parser for CSV and PowerPlanner HTML exports disguised as `.xls`. Reject other binary `.xls` files with a clear message: “이 형식은 지원하지 않습니다. 한전/Excel에서 XLSX 또는 CSV로 다시 저장해 주세요.”

- [ ] **Step 4: Preserve parser limits and formula safety**

Continue enforcing 10 MB and 10,000 rows before mapping. Read displayed cell values only; do not evaluate formulas, external links, macros, or HTML. Never insert uploaded cell content through `dangerouslySetInnerHTML`.

- [ ] **Step 5: Update security documentation**

Remove the old `xlsx` warning only after the dependency is absent from `npm ls`. Document supported formats as `.xlsx`, `.csv`, and PowerPlanner HTML-`.xls`; document rejection of legacy binary `.xls`.

- [ ] **Step 6: Verify dependency and parser state**

Run:

```bash
npm ls xlsx
npm ls exceljs
npm audit --omit=dev
npm run test -- src/lib/excel.test.ts src/lib/powerPlanner.test.ts
```

Expected: `xlsx` absent, ExcelJS present, fixture test PASS. Any remaining audit finding must be recorded before deployment.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/lib/excel.ts src/lib/excel.test.ts e2e/fixtures/monthly-bills.xlsx README.md docs/upload-security-plan.md
git commit -m "security: replace vulnerable spreadsheet parser"
```

---

### Task 8: Regression Matrix, Build, and Production Smoke

**Files:**
- Modify: `e2e/auto-diagnosis.e2e.ts`
- Modify: `README.md`
- Modify: `docs/calculation-notes.md`
- Modify: `docs/deployment.md`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: all preceding task interfaces
- Produces: deployment evidence for data integrity, privacy, expiry, and parser migration

- [ ] **Step 1: Add the missing regression matrix**

Add focused scenarios for:

```ts
test('duplicate and gapped months block change documents', async () => {})
test('calendar rollover selects the true recent 12 months', async () => {})
test('unknown current plan blocks diagnosis', async () => {})
test('PowerPlanner-only upload stays sample-bill mode', async () => {})
test('custom display name reaches preview and ZIP filename', async () => {})
test('invalid peak target is rejected', async () => {})
```

- [ ] **Step 2: Run the complete local gate**

Run in order:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm run test:e2e
```

Expected: every command exits `0`; no skipped real-workbook test remains.

- [ ] **Step 3: Split heavy views from the initial bundle**

Keep `html2pdf.js` lazy-loaded. Convert Dashboard, RateSimulator, PeakManager, and DocumentGenerator imports in `App.tsx` to `React.lazy` named-export adapters and wrap the active view in `Suspense`:

```ts
const Dashboard = lazy(() =>
  import('./components/dashboard/Dashboard').then((module) => ({
    default: module.Dashboard,
  })),
)
```

Use the same pattern for the other heavy views. The fallback must preserve the view frame dimensions and display `화면을 불러오는 중입니다.`. Rerun `npm run build` and require the initial `index-*.js` chunk to be below 700 kB minified.

- [ ] **Step 4: Run production smoke after NAS deployment**

Use the checked-in synthetic XLSX and PowerPlanner CSV to verify:

1. Bill upload recognizes 12 consecutive months.
2. PowerPlanner-only upload does not claim a bill upload.
3. Recommendation and peak controls use uploaded data.
4. ZIP contains three valid PDFs and uses the configured display name.
5. Mobile navigation remains usable.
6. Console and page errors are zero; Cloudflare telemetry failures are reported separately.

- [ ] **Step 5: Update operational documentation**

Document the canonical calendar-period rule, observed-vs-derived fields, document gate, shared TTL semantics, supported spreadsheet formats, and rollback procedure.

- [ ] **Step 6: Commit**

```bash
git add e2e/auto-diagnosis.e2e.ts README.md docs/calculation-notes.md docs/deployment.md src/App.tsx
git commit -m "test: cover diagnosis hardening workflow"
```

---

## Final Review Gate

- [ ] Confirm no tracked source contains `등촌`, `8616`, or `9136`.
- [ ] Confirm sample data is synthetic and has 36 distinct consecutive calendar months.
- [ ] Confirm only user-uploaded bills can unlock change-document downloads.
- [ ] Confirm PowerPlanner records affect peak enrichment without replacing bills.
- [ ] Confirm invalid current plans and non-positive peak targets are blocked.
- [ ] Confirm all persisted user data shares one absolute 24-hour expiry and live state clears at expiry.
- [ ] Confirm `xlsx@0.18.5` is absent and the synthetic XLSX fixture passes.
- [ ] Confirm `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`, and `npm run test:e2e` all pass.
- [ ] Confirm production smoke passes at `https://el-bill.h19h19.com/`.

## Out of Scope

- Pixel-level reproduction of the original HWP/PDF official forms.
- Actual KEPCO authentication, crawling, unofficial API access, or automatic data collection.
- Official billing certification or replacement of KEPCO billing calculations.
- Git-history rewriting without separate explicit approval.

## References

- ExcelJS supports reading and writing XLSX workbooks: <https://github.com/exceljs/exceljs>
- SheetJS security guidance: <https://docs.sheetjs.com/docs/miscellany/security/>
