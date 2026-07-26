# Final Review Fix C Report

## Scope

- Added typed `CalculationSettings` with `billDelta` defaults:
  - climate environment: `9 won/kWh`
  - fuel adjustment: `-5 won/kWh`
  - VAT: `10%`
  - power industry fund: `3.7%`
- Added finite-value and range validation. Fuel adjustment accepts negative values.
- Removed correction-factor constants from `estimateBillForPlan`.
- Propagated one settings instance through current, candidate, peak, 12-month,
  36-month, and calculation-breakdown diagnosis paths.
- Added accessible calculation-mode radio controls, correction-factor inputs,
  validation, and reset-to-default behavior.
- Persisted settings in the existing atomic, session-scoped snapshot protocol.
  Missing settings in older snapshots default without changing their TTL.
- Kept sample/no-session settings in memory only.
- Reused the diagnosis comparison in Dashboard, RateSimulator, and documents;
  removed the Dashboard's unused secondary tariff comparison.
- Added mode and mode-B factor values to the document calculation basis.
- Updated README and calculation notes.

## TDD Evidence

Tests were written and observed failing before each production change:

1. Missing settings model and calculation API failed module resolution.
2. Settings UI tests failed because radio controls, numeric inputs, validation,
   reset, and persist-first behavior did not exist.
3. Snapshot tests failed because settings were not serialized or defaulted for
   old snapshots.
4. App tests failed because settings were not owned, restored, patched, or
   adopted across tabs.
5. Document and RateSimulator tests failed because mode-B factors and the
   selected mode were not displayed.
6. Chromium E2E exposed a real rapid-edit race: a factor edit could overwrite a
   pending mode change. Calculation controls are now disabled until the atomic
   write completes.
7. A Dashboard test exposed an unused second tariff calculation with default
   factors. That calculation was removed.

## Verification

- `npm run typecheck`: passed
- `npm run lint`: passed
- `npm run test`: 22 files, 183 tests passed
- `npm run build`: passed
- initial Vite entry: 267,086 bytes, under the 700,000-byte budget
- `npm run test:e2e`: 8 Chromium tests passed
- `git diff --check`: passed

Vite still reports the existing warning for large lazy-loaded Excel/PDF chunks.
The initial application entry remains within the enforced budget.

## Review Round Follow-up

- Separated the non-scenario baseline from the peak/usage scenario:
  - `currentAnnualWon`, `candidateAnnualWon`, and `savingWon` use the latest
    consecutive 12 months without scenario adjustments.
  - `currentThreeYearWon`, `candidateThreeYearWon`, and
    `threeYearSavingWon` use actual consecutive 36-month rows without scenario
    adjustments.
  - `peakScenarioCurrentAnnualWon`, `peakScenarioCandidateAnnualWon`, and
    `peakScenarioSavingWon` independently apply the configured peak and usage
    scenario to the latest consecutive 12 months.
- Added explicit annual and 36-month data-availability flags. UI tables and
  cards now show an accurate insufficient-data state instead of presenting
  zero as a calculated three-year result.
- Made all three RateSimulator tabs functional and covered tab switching with
  distinct current, candidate, and saving values.
- Added `rotateNewStorageSnapshot`. It acquires the existing Web Lock, rereads
  the latest active snapshot, and applies only the upload updater before
  rotating the active session. Stale bill and PowerPlanner uploads preserve
  unrelated latest fields, including calculation settings and provenance.
- Removed the unused legacy `comparePlans` API. `estimateBillForPlan`,
  `comparePlansForDiagnosis`, and `buildAutoDiagnosis` now require explicit
  calculation settings; no public calculation path silently supplies mode-B
  factors.
- Added unit-bearing accessible names and field-specific
  `aria-invalid`/`aria-describedby` relationships for all correction factors.
- Updated automatic diagnosis cards, candidate tables, document text, README,
  and calculation notes to use the separated metrics and mode-B factors.

## Review Round TDD Evidence

1. Diagnosis tests failed because baseline totals changed with peak and usage
   scenario inputs and because three-year current/candidate fields did not
   exist.
2. RateSimulator tests failed because tab clicks did not change displayed
   values and 36-month gaps were shown as zero.
3. Storage lock tests failed before the generic rotation API existed. An App
   integration test reproduced a stale bill tab overwriting newer
   calculation settings and PowerPlanner data.
4. Accessibility tests failed before unit-bearing names and associated
   validation descriptions were added.
5. AutoDiagnosis and document tests failed before separated totals and mode-B
   factor details were rendered.

## Review Round Verification

- `npm run typecheck`: passed
- `npm run lint`: passed
- `npm run test -- --run`: 22 files, 189 tests passed
- `npm run build`: passed
- initial Vite entry: 272,641 bytes, under the 700,000-byte budget
- `npm run test:e2e`: 8 Chromium tests passed
- `git diff --check`: passed

Vite continues to report only the existing large lazy-loaded Excel/PDF chunk
warning.

## Second Review Round

- Added independent availability semantics:
  - annual results require 12 consecutive calendar months;
  - three-year results require 36 consecutive calendar months;
  - peak results require annual data and a valid peak scenario.
- Added boundary coverage for 1, 11, 12, 35, and 36 months. Unavailable
  periods retain typed false flags and are rendered as `자료 부족`; partial
  sums and zeroes are not presented as completed results.
- Corrected `billDelta` so a no-scenario current month equals the uploaded
  `totalBillWon` exactly. Baseline 12/36-month current totals are therefore
  exact sums of uploaded bills.
- Corrected scenario calculations to start from the actual bill, apply current
  base-charge and energy-charge changes with the observed ancillary ratio, and
  then apply the candidate component delta once from the adjusted current
  basis. Missing observed base/energy components use current-plan rates.
- Added exact tests for current totals, peak base increases, usage increases,
  missing optional component fallbacks, and candidate deltas.
- Updated Dashboard, AutoDiagnosis, PlanCandidateTable, RateSimulator, and
  document templates to honor each availability flag. Document previews are
  not constructed when the annual period is unavailable.
- Added accessible RateSimulator tablist, tab, selected-state, control, and
  tabpanel relationships.
- Updated README and calculation notes with the actual availability rules and
  `billDelta` formula.

## Second Review Round TDD Evidence

1. Boundary tests failed because 1- and 11-month partial sums were exposed as
   annual results and peak availability was not modeled.
2. Exact numeric tests failed because the no-scenario current path recalculated
   components and the peak current path omitted the base-charge delta.
3. UI tests failed because annual and peak cards/tables rendered `0원` and the
   simulator used annual availability for its peak tab.
4. Document tests failed because unavailable metrics were formatted as zeroes
   and a plausible preview was built with only 11 months.
5. Accessibility tests failed because the simulator range controls were plain
   buttons without tab and panel semantics.

## Second Review Round Verification

- `npm run typecheck`: passed
- `npm run lint`: passed
- `npm test -- --run`: 23 files, 209 tests passed
- `npm run build`: passed
- initial Vite entry: 274,897 bytes, under the 700,000-byte budget
- `npm run test:e2e`: 8 Chromium tests passed
- `git diff --check`: passed

Vite continues to report only the existing large lazy-loaded Excel/PDF chunk
warning.

## Third Review Round

- Replaced optional adjustment-column summation in `billDelta` with the actual
  bill residual:
  - observed positive base and energy components are preferred;
  - missing components use current-plan rate fallbacks;
  - residual is `totalBillWon - baselineBase - baselineEnergy`;
  - ancillary ratio is `residual / (baselineBase + baselineEnergy)`.
- Kept the established safe ancillary-ratio clamp at `-20%..35%`, now with
  named bounds and matching documentation. Exact tests cover absent adjustment
  columns, partial columns, negative fuel adjustment, larger residuals, and
  both clamp limits. Baseline current totals remain exact uploaded totals.
- With fewer than 12 consecutive months, every candidate is now explicitly
  marked `추가 검토 필요` and `recommendedPlan` is `null`. Dashboard,
  AutoDiagnosis, RateSimulator, and document generation all use the same
  blocked state without exposing an arbitrary candidate name.
- Completed RateSimulator tab keyboard behavior:
  - only the selected tab has `tabIndex=0`;
  - Left/Right arrows wrap;
  - Home/End select the first/last tab;
  - focus, `aria-selected`, and panel linkage move together.
- Added `@testing-library/user-event` for interaction-level keyboard tests.

## Third Review Round TDD Evidence

1. Residual tests failed because omitted or partial optional adjustment columns
   changed the scenario result despite an unchanged actual bill total.
2. Clamp tests failed because the previous ratio came from adjustment fields
   instead of the total residual.
3. One- and eleven-month tests failed because `recommendedPlan` still exposed
   the first ranked candidate.
4. Dashboard and AutoDiagnosis tests failed because the arbitrary candidate
   kept the full result UI open.
5. RateSimulator tests failed because unavailable annual data left the
   simulator controls open and every tab remained in the keyboard tab order.
6. `user-event` arrow-key tests failed until selection, focus, wrapping, and
   panel associations were implemented together.

## Third Review Round Verification

- `npm run typecheck`: passed
- `npm run lint`: passed
- `npm test -- --run`: 23 files, 218 tests passed
- `npm run build`: passed
- initial Vite entry: 274,995 bytes, under the 700,000-byte budget
- `npm run test:e2e`: 8 Chromium tests passed
- `git diff --check`: passed

Vite continues to report only the existing large lazy-loaded Excel/PDF chunk
warning. `npm install` reported the repository's existing dependency audit
findings; no automatic audit fix was applied.
