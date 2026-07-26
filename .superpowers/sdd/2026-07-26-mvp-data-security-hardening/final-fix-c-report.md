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

