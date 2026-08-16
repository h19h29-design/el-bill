# Easy Diagnosis Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a beginner-only five-step diagnosis wizard that requires 12 consecutive months and leads with an explicit change, maintain, or do-not-change command while leaving existing expert tabs unchanged.

**Architecture:** Add pure readiness and result-presentation helpers under `src/lib`, then build purpose-specific step components under `src/components/easyDiagnosis`. The wizard uses existing browser-only PDF/workbook parsing and diagnosis calculation functions, but does not render the existing `BillUpload`, `AutoDiagnosis`, or `RatePlanSettings` screens. `App` saves the accepted bills, profile, and provenance in one storage snapshot before showing the result.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Vitest, Testing Library, Playwright, existing ExcelJS/pdfjs parsers, existing localStorage snapshot TTL.

## Global Constraints

- Keep every existing expert sidebar tab and its current behavior.
- `12개월 요금 정리표` means a school-maintained 12-month usage and total-charge table, not a KEPCO tariff schedule.
- Never issue a change or maintain conclusion with fewer than 12 consecutive months.
- Never use the built-in sample bills as a real easy-diagnosis result.
- Keep all parsing in the browser and preserve the maximum 24-hour deletion policy.
- Keep the internal-estimate disclaimer and the one-change-per-year caution in the result.
- Do not add KEPCO login, crawling, unofficial API calls, automatic OCR uploads, or automatic contract submission.
- Use the existing blue, white, and teal public-sector visual system with radii no larger than 8px.

---

### Task 1: Lock Down Easy-Diagnosis Readiness And Decision Copy

**Files:**
- Create: `src/lib/easyDiagnosis.ts`
- Create: `src/lib/easyDiagnosis.test.ts`

**Interfaces:**
- Consumes: `BillInputCandidate`, `MonthlyBill`, `AutoDiagnosisResult`, `DataProvenance`, `SchoolProfile`, `RatePlan`, `validateBillPeriods`, `findExactRatePlan`, and `getDiagnosisDecisionPresentation`.
- Produces: `EasyDiagnosisSource`, `EasyDiagnosisStep`, `EasyDiagnosisReview`, `EasyDiagnosisDecision`, `buildEasyDiagnosisReview(candidate)`, `getEasyDiagnosisProfileIssue(profile, plans)`, and `buildEasyDiagnosisDecision(diagnosis, provenance)`.

- [ ] **Step 1: Write failing tests for the 12-month gate**

```ts
it('blocks eleven months and names the missing requirement', () => {
  const review = buildEasyDiagnosisReview(candidate(sampleBills.slice(-11)))
  expect(review.canContinue).toBe(false)
  expect(review.consecutiveMonthCount).toBe(11)
  expect(review.issues).toContain('연속 12개월 자료가 필요합니다. 현재 11개월을 확인했습니다.')
})

it('accepts the latest twelve consecutive months', () => {
  const review = buildEasyDiagnosisReview(candidate(sampleBills.slice(-12)))
  expect(review.canContinue).toBe(true)
  expect(review.bills).toHaveLength(12)
})

it('blocks duplicate and gapped periods with their concrete messages', () => {
  const bills = [...sampleBills.slice(-12), sampleBills.at(-1)!]
  const review = buildEasyDiagnosisReview(candidate(bills))
  expect(review.canContinue).toBe(false)
  expect(review.issues.some((issue) => issue.includes('중복'))).toBe(true)
})
```

- [ ] **Step 2: Run the new helper test and verify RED**

Run: `npx vitest run src/lib/easyDiagnosis.test.ts`

Expected: FAIL because `src/lib/easyDiagnosis.ts` does not exist.

- [ ] **Step 3: Implement the readiness types and helper**

```ts
export type EasyDiagnosisSource = 'pdf' | 'table' | 'paste' | 'manual'
export type EasyDiagnosisStep = 'source' | 'import' | 'review' | 'profile' | 'result'

export interface EasyDiagnosisReview {
  bills: MonthlyBill[]
  consecutiveMonthCount: number
  periodLabel: string
  observedOptionalFields: string[]
  issues: string[]
  canContinue: boolean
}

export const buildEasyDiagnosisReview = (
  candidate: BillInputCandidate | null,
): EasyDiagnosisReview => {
  if (!candidate) return emptyEasyDiagnosisReview
  const validation = validateBillPeriods(candidate.bills)
  const latestTwelve = validation.recentConsecutiveBills.slice(-12)
  const issues = validation.issues.map((issue) => issue.message)
  if (!validation.hasRequiredConsecutiveMonths) {
    issues.push(
      `연속 12개월 자료가 필요합니다. 현재 ${validation.recentConsecutiveBills.length}개월을 확인했습니다.`,
    )
  }
  return {
    bills: latestTwelve,
    consecutiveMonthCount: validation.recentConsecutiveBills.length,
    periodLabel: formatEasyDiagnosisPeriod(latestTwelve),
    observedOptionalFields: getEasyDiagnosisObservedFields(latestTwelve),
    issues,
    canContinue:
      validation.hasRequiredConsecutiveMonths &&
      validation.issues.length === 0,
  }
}
```

Use exactly the latest 12 consecutive records for the easy diagnosis even when the source contains 36 months. Preserve the full candidate in the wizard only for preview metadata; save the normalized source records so expert screens retain all uploaded history.

- [ ] **Step 4: Write failing tests for profile readiness and user commands**

```ts
it('requires an exact current tariff and positive applied power', () => {
  expect(getEasyDiagnosisProfileIssue(
    { ...defaultSchoolProfile, appliedPowerKw: 0 },
    defaultRatePlans,
  )).toContain('요금적용전력')
})

it.each([
  ['변경 추천', '선택요금Ⅰ으로 변경하세요'],
  ['유지 추천', '현재 선택요금Ⅱ를 유지하세요'],
  ['추가 검토 필요', '지금은 변경하지 마세요'],
] as const)('maps %s to %s', (judgement, command) => {
  const diagnosis = diagnosisFixture({ finalJudgement: judgement })
  expect(buildEasyDiagnosisDecision(diagnosis, userProvenance).command).toBe(command)
})

it('blocks sample provenance from producing a real result', () => {
  const decision = buildEasyDiagnosisDecision(diagnosisFixture(), sampleProvenance)
  expect(decision.command).toBe('실제 12개월 자료를 먼저 넣어주세요')
  expect(decision.canAct).toBe(false)
})
```

- [ ] **Step 5: Run the helper test and verify RED for the new cases**

Run: `npx vitest run src/lib/easyDiagnosis.test.ts`

Expected: FAIL because profile and decision helpers are not implemented.

- [ ] **Step 6: Implement profile and decision helpers**

```ts
export interface EasyDiagnosisDecision {
  tone: 'change' | 'maintain' | 'review'
  command: string
  summary: string
  reasons: string[]
  cautions: string[]
  canAct: boolean
}

export const getEasyDiagnosisProfileIssue = (
  profile: SchoolProfile,
  ratePlans: RatePlan[],
) => {
  if (!(profile.appliedPowerKw > 0)) {
    return '요금적용전력은 0보다 큰 값으로 입력해 주세요.'
  }
  if (!findExactRatePlan(profile, ratePlans)) {
    return '계약종별, 수전전압, 현재 요금제와 일치하는 학교용 요금제를 선택해 주세요.'
  }
  return null
}
```

Build the decision from the existing diagnosis presentation so both result screens agree. Add the internal-estimate disclaimer, missing 36-month caution when applicable, peak assumption, and `요금제 변경 신청은 원칙적으로 1년에 한 번만 가능` caution. Treat `추가 검토 필요` as a non-actionable review decision even when a candidate exists.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run: `npx vitest run src/lib/easyDiagnosis.test.ts src/lib/diagnosis.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit the domain slice**

```bash
git add src/lib/easyDiagnosis.ts src/lib/easyDiagnosis.test.ts
git commit -m "feat: define easy diagnosis decision rules"
```

---

### Task 2: Build The Purpose-Specific Five-Step Wizard

**Files:**
- Create: `src/components/easyDiagnosis/EasyDiagnosisWizard.tsx`
- Create: `src/components/easyDiagnosis/EasyDiagnosisSourceStep.tsx`
- Create: `src/components/easyDiagnosis/EasyDiagnosisImportStep.tsx`
- Create: `src/components/easyDiagnosis/EasyDiagnosisReviewStep.tsx`
- Create: `src/components/easyDiagnosis/EasyDiagnosisProfileStep.tsx`
- Create: `src/components/easyDiagnosis/EasyDiagnosisResultStep.tsx`
- Create: `src/components/easyDiagnosis/EasyDiagnosisWizard.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: Task 1 helpers; existing `parseBillPdfFiles`, `parseWorkbook`, `parsePastedBillSheet`, `buildBillColumnMapping`, `mapRowsToBills`, `AiBillConversionHelper`, `PlanCandidateTable`, and rate-plan data.
- Produces: `EasyDiagnosisApplyInput` and `EasyDiagnosisWizard`.

```ts
export interface EasyDiagnosisApplyInput {
  candidate: BillInputCandidate
  profile: SchoolProfile
}

interface EasyDiagnosisWizardProps {
  profile: SchoolProfile
  ratePlans: RatePlan[]
  diagnosis: AutoDiagnosisResult
  dataProvenance: DataProvenance
  onApply: (input: EasyDiagnosisApplyInput) => Promise<boolean>
  onNavigate: (view: ViewKey) => void
  onOpenGuide: (sectionId: string) => void
}
```

- [ ] **Step 1: Write failing tests for source selection and step navigation**

```tsx
it('starts with four source choices and a twelve-month requirement', () => {
  renderWizard()
  expect(screen.getByRole('heading', { name: '어떤 자료를 가지고 있나요?' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '12개월 고지서 PDF' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '12개월 요금 정리표' })).toBeTruthy()
  expect(screen.getByText(/연속 12개월/)).toBeTruthy()
})

it('shows only the selected file input on the import step', async () => {
  const user = userEvent.setup()
  renderWizard()
  await user.click(screen.getByRole('button', { name: '12개월 고지서 PDF' }))
  expect(screen.getByLabelText('12개월 고지서 PDF 선택')).toBeTruthy()
  expect(screen.queryByLabelText('12개월 요금 정리표 선택')).toBeNull()
})
```

- [ ] **Step 2: Run the wizard test and verify RED**

Run: `npx vitest run src/components/easyDiagnosis/EasyDiagnosisWizard.test.tsx`

Expected: FAIL because the wizard components do not exist.

- [ ] **Step 3: Implement the wizard shell and source step**

Use a controlled five-step state machine. Every transition checks the current step precondition before changing `step`. Render one `<section>` for the active step, one persistent progress list with `aria-current="step"`, and `이전` / contextual primary action controls. `새로 시작` clears only wizard-local state until a new candidate is applied.

- [ ] **Step 4: Write failing tests for PDF, workbook, paste, and manual candidates**

Mock the parser boundary in component tests and assert that each source emits a `BillInputCandidate`. Add an integration-style test with a real 12-row pasted table. Add a manual-entry test that fills or pastes 12 `연월 / 사용량 / 총요금` rows and reaches review.

```tsx
expect(screen.getByRole('heading', { name: '12개월 자료를 확인했습니다' })).toBeTruthy()
expect(screen.getByText('12/12개월')).toBeTruthy()
expect(screen.getByRole('button', { name: '계약정보 확인으로 이동' })).toBeEnabled()
```

- [ ] **Step 5: Run the input tests and verify RED**

Run: `npx vitest run src/components/easyDiagnosis/EasyDiagnosisWizard.test.tsx`

Expected: FAIL because the import and review steps do not parse or present candidates.

- [ ] **Step 6: Implement the import and review steps**

For PDF, call `parseBillPdfFiles(files, importContext)` and use `autoRows`. For XLSX/CSV, call `parseWorkbook`, use `autoRows` when present, otherwise auto-map the first selected sheet with `buildBillColumnMapping` and `mapRowsToBills`. Show only the selected source input. Keep mapping correction limited to sheet choice and the four required fields in this beginner flow.

For paste, parse a tab- or comma-delimited table with `parsePastedBillSheet` and the four required auto mappings. For manual input, render exactly 12 stable rows with `연월`, `사용량`, and `총요금`; allow a multi-cell paste into the usage cell to fill consecutive rows. Build `MonthlyBill` values with optional amounts set to zero and `observedFields` limited to the fields actually entered.

The review step shows period, `12/12개월`, required fields, optional observed fields, and at most 12 compact monthly rows. It does not render `BillTable` or the existing full current-data table. It blocks progress for duplicates, gaps, or fewer than 12 consecutive months and displays every Task 1 issue.

- [ ] **Step 7: Write failing tests for profile validation and atomic apply callback**

```tsx
it('does not analyze until the exact contract and applied power are valid', async () => {
  renderWizardAtProfile({ appliedPowerKw: 0 })
  expect(screen.getByRole('button', { name: '자동 분석 시작' })).toBeDisabled()
  expect(screen.getByText(/요금적용전력/)).toBeTruthy()
})

it('applies bills and profile once before opening the result', async () => {
  const onApply = vi.fn(async () => true)
  renderWizardAtProfile({}, { onApply })
  await userEvent.click(screen.getByRole('button', { name: '자동 분석 시작' }))
  expect(onApply).toHaveBeenCalledTimes(1)
  expect(screen.getByText(/분석 중/)).toBeTruthy()
})
```

- [ ] **Step 8: Run profile tests and verify RED**

Run: `npx vitest run src/components/easyDiagnosis/EasyDiagnosisWizard.test.tsx`

Expected: FAIL because profile and apply behavior are not implemented.

- [ ] **Step 9: Implement profile and result steps**

The profile step offers dependent selectors for contract type, voltage, and current plan, plus a numeric applied-power input. Prefill from the current profile and candidate observed applied power. Use Task 1 profile validation to enable `자동 분석 시작`.

The result step renders the Task 1 command as its H2, annual impact as the next largest value, three reasons, cautions, confidence, and data limitations. Hide `PlanCandidateTable` and breakdowns inside a native `<details>` named `상세 결과 보기`. Change recommendations link to `peak` and `docs`; maintain recommendations link to restart; review decisions link back to the relevant incomplete step.

- [ ] **Step 10: Add responsive and accessible wizard styles**

Add `.easy-diagnosis-*` styles using existing color tokens. Use one primary work surface per page, a five-step rail on desktop, a compact current-step list on mobile, stable 44px controls, and no nested card structures. Verify the 360px layout has no horizontal overflow.

- [ ] **Step 11: Run focused component tests and verify GREEN**

Run: `npx vitest run src/components/easyDiagnosis/EasyDiagnosisWizard.test.tsx src/components/diagnosis/PlanCandidateTable.test.tsx`

Expected: PASS.

- [ ] **Step 12: Commit the wizard slice**

```bash
git add src/components/easyDiagnosis src/styles.css
git commit -m "feat: add beginner diagnosis wizard"
```

---

### Task 3: Integrate Navigation And Atomic Storage Without Changing Expert Tabs

**Files:**
- Modify: `src/types.ts`
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/components/dashboard/Dashboard.tsx`
- Modify: `src/components/dashboard/Dashboard.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/App.atomic-storage.test.tsx`

**Interfaces:**
- Consumes: Task 2 `EasyDiagnosisWizard` and `EasyDiagnosisApplyInput`; existing `rotateNewStorageSnapshot`, `applySchoolProfileIntent`, storage snapshot state, and diagnosis memo.
- Produces: `ViewKey = ... | 'easyDiagnosis'` and `applyEasyDiagnosisInput(input): Promise<boolean>`.

- [ ] **Step 1: Write failing navigation tests**

```tsx
it('opens the easy diagnosis from the dashboard CTA', async () => {
  render(<App />)
  await userEvent.click(screen.getByRole('button', { name: '쉬운 진단 시작' }))
  expect(screen.getByRole('heading', { name: '쉬운 진단' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: '어떤 자료를 가지고 있나요?' })).toBeTruthy()
})

it('keeps the existing expert diagnosis menu', () => {
  render(<App />)
  expect(screen.getByRole('button', { name: '쉬운 진단' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '자동진단' })).toBeTruthy()
})
```

- [ ] **Step 2: Run App and dashboard tests and verify RED**

Run: `npx vitest run src/App.test.tsx src/components/dashboard/Dashboard.test.tsx`

Expected: FAIL because the new view and CTA do not exist.

- [ ] **Step 3: Add the view, sidebar item, lazy route, and CTA**

Add `easyDiagnosis` to `ViewKey`, `viewMeta`, and the sidebar immediately after dashboard. Lazy-load `EasyDiagnosisWizard`. Change the dashboard CTA visible label to `쉬운 진단 시작`; do not rename or remove `자동진단` in the expert sidebar.

- [ ] **Step 4: Write a failing atomic-storage test**

Create a valid easy-diagnosis apply input and trigger `자동 분석 시작`. Assert that one new active snapshot contains the new bills, patched contract profile, and user bill provenance together, and that the wizard does not show result when the storage write fails.

```ts
expect(snapshot.data.bills).toEqual(expectedBills)
expect(snapshot.data.profile.appliedPowerKw).toBe(497)
expect(snapshot.data.provenance.bills).toBe('uploaded')
```

- [ ] **Step 5: Run the atomic-storage test and verify RED**

Run: `npx vitest run src/App.atomic-storage.test.tsx`

Expected: FAIL because App has no easy-diagnosis atomic write.

- [ ] **Step 6: Implement one-snapshot apply**

```ts
const applyEasyDiagnosisInput = async ({
  candidate,
  profile: nextProfile,
}: EasyDiagnosisApplyInput): Promise<boolean> =>
  startUploadSession((latest) => ({
    bills: candidate.bills,
    profile: nextProfile,
    provenance: {
      ...latest.provenance,
      bills: candidate.origin,
    },
  }))
```

Validate the next profile and exact rate plan before calling storage. Keep the existing `applyBills`, profile editing, and expert view callbacks unchanged.

- [ ] **Step 7: Run integration tests and verify GREEN**

Run: `npx vitest run src/App.test.tsx src/App.atomic-storage.test.tsx src/components/dashboard/Dashboard.test.tsx src/components/easyDiagnosis/EasyDiagnosisWizard.test.tsx`

Expected: PASS.

- [ ] **Step 8: Commit the integration slice**

```bash
git add src/types.ts src/components/layout/Sidebar.tsx src/components/dashboard/Dashboard.tsx src/components/dashboard/Dashboard.test.tsx src/App.tsx src/App.test.tsx src/App.atomic-storage.test.tsx
git commit -m "feat: connect easy diagnosis flow"
```

---

### Task 4: Add End-To-End Coverage, Documentation, And Full Verification

**Files:**
- Modify: `e2e/auto-diagnosis.e2e.ts`
- Modify: `README.md`
- Modify: `docs/calculation-notes.md`

**Interfaces:**
- Consumes: the completed wizard and existing checked-in XLSX/PDF E2E fixtures.
- Produces: regression coverage for beginner PDF/table flows and production documentation.

- [ ] **Step 1: Write failing E2E scenarios**

Add scenarios for:

1. Dashboard `쉬운 진단 시작` → 12-month XLSX → review → contract → explicit result.
2. Easy diagnosis PDF path with the existing 12 generated bill payloads.
3. Eleven months → `지금은 변경하지 마세요` is not treated as a computed result and progression is blocked with a missing-month explanation.
4. Result details are initially closed and reveal TOP 3 only after `상세 결과 보기`.
5. Existing sidebar `자동진단`, `고지서 입력`, `피크관리`, and `문서생성` still open.

- [ ] **Step 2: Run the targeted E2E tests and verify RED**

Run: `npm run test:e2e -- --grep "쉬운 진단"`

Expected: FAIL until selectors and the completed flow are connected.

- [ ] **Step 3: Fix only E2E-discovered product defects**

Do not weaken assertions. Correct labels, disabled-state explanations, focus transitions, parser handling, result copy, or responsive layout in the owning component and add a focused unit/component regression test for every product defect found.

- [ ] **Step 4: Update user and calculation documentation**

README must explain the new five-step beginner flow, distinguish 12-month billing tables from tariff schedules, and state that expert tabs remain. Calculation notes must state that easy diagnosis uses the latest 12 consecutive months, blocks conclusions when the gate is unmet, and maps the existing diagnosis result to explicit beginner commands without changing the engine.

- [ ] **Step 5: Run static and unit verification**

Run in order:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 6: Run full browser verification**

Start the production preview on an unused local port. Use the Browser plugin first to test:

`dashboard → 쉬운 진단 시작 → source → import → review → profile → result → details`

Verify page identity, meaningful DOM, no framework overlay, no relevant console warnings or errors, visible screenshot evidence, desktop viewport, 360px mobile viewport, and at least one expert tab after the wizard. Run `npm run test:e2e` as the full automated regression suite.

- [ ] **Step 7: Commit documentation and E2E coverage**

```bash
git add e2e/auto-diagnosis.e2e.ts README.md docs/calculation-notes.md
git commit -m "test: cover easy diagnosis journey"
```

- [ ] **Step 8: Final verification and branch completion**

Run `git status --short`, `git diff --check main...HEAD`, and the required verification commands again after the final commit. Then invoke `superpowers:finishing-a-development-branch`, push `codex/easy-diagnosis-wizard`, fast-forward `main` only after all checks pass, deploy the exact built artifact to the NAS target documented in `docs/deployment.md`, and run the production smoke test against `https://el-bill.h19h19.com/`.
