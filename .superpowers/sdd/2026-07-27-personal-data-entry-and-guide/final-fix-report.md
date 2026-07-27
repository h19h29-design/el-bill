# Final Whole-Branch Fix Report

Date: 2026-07-27

Worktree: `/Users/mac-mini/Documents/전기요금/.worktrees/personal-data-entry-guide`

Reviewed base: `94ea07dc3f7c994a1efbfe584c3e58f78bb5f3ba`

Implementation commit:
`4847b8b89e515e08ceadda016712bb7b1ce61e1a`

The follow-up commit containing this report changes documentation only.

## Result

All blocking and minor findings 1-13 are addressed. The two explicit item 14
deferrals remain in place. Browser-local processing, the fixed 24-hour draft
TTL, no-inference mapping, copy-on-write draft commits, CAS removal, and atomic
applied-data snapshots are preserved.

## TDD Evidence

The first focused RED run covered:

```text
src/lib/billInput.test.ts
src/components/bills/PastedBillInput.test.tsx
src/components/bills/ManualBillInput.test.tsx
src/lib/localDirectoryImport.test.ts
src/content/usageGuide.test.ts
src/components/guide/UsageGuide.test.tsx
src/components/dashboard/Dashboard.test.tsx
src/components/bills/FileBillInput.test.tsx
```

RED: 14 failed, 77 passed (91 total). The failures covered headerless row
loss, broad/ambiguous mapping, duplicate source ownership, numeric
precision/magnitude, strict period parsing, short XLSX scanning, display-only
formatting, missing mobile/status copy, the direct file apply action,
dashboard status/provenance, and object URL cleanup.

GREEN: the same 8 files passed 91/91 after the first correction group.

Additional focused RED evidence:

- Undefined-revision draft overwrite: the create-only test received a
  successful overwrite instead of `{ ok: false, reason: 'stale' }`.
- Exact draft removal: the new test failed because
  `readBillEntryDraftRecord` did not exist.
- Missing-draft CAS cleanup: orphan generation removal returned
  `removed: false`.
- Failed generation cleanup retry: the active pointer remained and made the
  retry path unusable.
- Navigation ordering: `onAnalysisOpen` was called 0 times instead of once
  after cleanup.
- Global cleanup: an expired draft pointer remained after App startup.
- Exact magnitude: `1000000000.000000000001` was rounded by `Number` and
  incorrectly accepted.

Focused GREEN evidence after correction:

- Draft storage: 30/30.
- Draft storage, lifecycle, and BillUpload transaction group: 49/49.
- Numeric/input display group: 41/41.
- App startup/timer/focus/visibility/retry cleanup group: 6/6, with the
  pending-write sample reset regression also passing.
- App atomic storage, BillUpload, and ManualBillInput integration group:
  47/47.

## Findings

### 1. Headerless Paste

Added a default-on `첫 행을 헤더로 사용` control. Headerless mode generates
stable `열 N` labels, retains the first data row, exposes mapping, and does not
infer required fields.

Files:

- `src/lib/billInput.ts`
- `src/lib/billInput.test.ts`
- `src/components/bills/PastedBillInput.tsx`
- `src/components/bills/PastedBillInput.test.tsx`
- `src/styles.css`

### 2. Exact Mapping And Source Ownership

Replaced substring mapping with normalized exact alias sets. Ambiguous and
duplicate aliases remain unmapped. Assigning a source column to another field
atomically clears its former owner in paste and file mapping.

Files:

- `src/lib/billInput.ts`
- `src/lib/billInput.test.ts`
- `src/components/bills/PastedBillInput.tsx`
- `src/components/bills/PastedBillInput.test.tsx`
- `src/components/bills/FileBillInput.tsx`

### 3. Global Draft TTL And Reset Cleanup

Moved cleanup ownership to App. App now runs startup maintenance, tracks the
active expiry, cleans on focus and visible-state return, listens for same-tab
and cross-tab pointer changes, and retries failures with visible status.
Successful file, paste, and manual applies remove the draft. Sample reset
cancels pending writes and removes the draft before resetting data.

Files:

- `src/App.tsx`
- `src/App.test.tsx`
- `src/lib/billDraftStorage.ts`
- `src/components/bills/BillUpload.tsx`
- `src/components/bills/ManualBillInput.tsx`

### 4. Draft CAS And Copy-On-Write

An undefined expected revision is now create-only. Successful writes expose an
identity containing session, revision, generation, and storage key. Removal
compares that complete identity while holding the shared lock. A stale remover
cannot delete a newer generation. Pointer-first removal leaves a failed
generation as a retryable orphan without creating a dangling active pointer.
The existing copy-on-write candidate/readback/pointer commit remains intact.

Files:

- `src/lib/billDraftStorage.ts`
- `src/lib/billDraftStorage.test.ts`
- `src/lib/storageLock.test.ts`
- `src/components/bills/manualBillDraftLifecycle.ts`

### 5. Apply, Cleanup, Then Navigate

Snapshot persistence and navigation are separated. The shared confirmation
flow now flushes the pending draft, captures its identity, persists the applied
snapshot, CAS-removes the draft, and only then opens diagnosis. Cleanup
failures retain the candidate and rows with a retry message. Edits arriving
during persistence or removal block navigation and are saved as a new draft.

The E2E manual and paste flows assert that the pointer and every generation key
are absent after real App navigation.

Files:

- `src/App.tsx`
- `src/App.atomic-storage.test.tsx`
- `src/components/bills/BillUpload.tsx`
- `src/components/bills/BillUpload.test.tsx`
- `src/components/bills/BillInputPreview.tsx`
- `src/components/bills/manualBillDraftLifecycle.ts`
- `src/components/bills/manualBillDraftLifecycle.test.ts`
- `e2e/auto-diagnosis.e2e.ts`

### 6. Raw Numeric State

Manual rows retain canonical source text. Grouping is display-only while an
input is unfocused; focus restores the exact raw value. Precision beyond 12
decimal places and field-specific magnitude limits are rejected. Magnitude
comparison uses normalized decimal text so a boundary value cannot pass by
floating-point rounding.

Files:

- `src/lib/billInput.ts`
- `src/lib/billInput.test.ts`
- `src/components/bills/ManualBillInput.tsx`
- `src/components/bills/ManualBillInput.test.tsx`

### 7. Deterministic Guide And Validation Contracts

Pinned the approved GPT prompt to UTF-8 byte length 1922 and SHA-256
`ca414ef9496f8bc7765c9596cc7ba3c699a3713405acbcf54bf739571247f4af`.
Pinned the exact BOM CSV header and empty row. Added strict non-canonical
period rejection, clipboard rejection status, download failure status, and URL
cleanup contracts.

Files:

- `src/content/usageGuide.test.ts`
- `src/lib/billInput.test.ts`
- `src/components/guide/UsageGuide.tsx`
- `src/components/guide/UsageGuide.test.tsx`

### 8. Exclusive Shared Lock

The lock test now captures every request option and asserts
`{ mode: 'exclusive' }` for all mutations. This was a characterization GREEN:
the production lock already requested exclusive mode. Draft transition
ownership was clarified by moving TTL maintenance to App and keeping apply
coordination in the lifecycle.

Files:

- `src/lib/storageLock.test.ts`
- `src/App.tsx`
- `src/components/bills/manualBillDraftLifecycle.ts`

### 9. One File Confirmation Boundary

Removed `FileBillInput`'s direct apply callback and button. All file candidates
now pass through `BillInputPreview` and its single
`이 데이터로 분석 시작` confirmation.

Files:

- `src/components/bills/FileBillInput.tsx`
- `src/components/bills/FileBillInput.test.tsx`
- `src/components/bills/BillUpload.tsx`
- `src/components/bills/BillUpload.test.tsx`

### 10. Short XLSX Directory Candidate

An XLSX candidate shorter than four bytes now fails signature validation and
the directory scan continues to a later valid supported file.

Files:

- `src/lib/localDirectoryImport.ts`
- `src/lib/localDirectoryImport.test.ts`

### 11. Manual Grid Mobile And Row Status

Added the required horizontal-scroll instruction. Valid populated/touched rows
show `입력 완료`; untouched generated rows retain `입력 대기`.

Files:

- `src/components/bills/ManualBillInput.tsx`
- `src/components/bills/ManualBillInput.test.tsx`
- `src/styles.css`

### 12. Dashboard Status And Provenance

The first KPI now shows diagnosis completion (`진단 완료` or
`추가 자료 필요`) and retains bill/PowerPlanner provenance in the same card.

Files:

- `src/components/dashboard/Dashboard.tsx`
- `src/components/dashboard/Dashboard.test.tsx`
- `e2e/auto-diagnosis.e2e.ts`

### 13. Object URL Cleanup

CSV download now revokes its object URL in `finally`, including when the
synthetic anchor click throws.

Files:

- `src/components/guide/UsageGuide.tsx`
- `src/components/guide/UsageGuide.test.tsx`

### 14. Explicit Deferrals Preserved

- The manual multi-cell E2E still uses a bounded synthetic clipboard event;
  no nondeterministic real clipboard permission dependency was added.
- `ManualBillInput` was not broadly split into new components. Changes remain
  scoped to lifecycle correctness, raw display, status, and mobile guidance.

## Final Verification

```text
npm run typecheck
PASS

npm run lint
PASS (oxlint)

npm run test
PASS: 39 files, 621 tests

npm run build
PASS: 629 modules transformed
PASS: initial entry 305,117 bytes / 700,000-byte budget
NOTE: existing large-chunk warnings remain for heavy lazy assets

npm run test:e2e
PASS: 15/15 Chromium tests

npm audit --omit=dev
EXIT 1: 10 findings (9 high, 1 moderate)
```

The audit findings are transitive through ExcelJS's Node-side archive
dependencies (`brace-expansion`/`minimatch`/`glob`/`archiver`) and `uuid`.
The offered forced remediation installs `exceljs@3.4.0`, a breaking downgrade.
No forced audit fix was applied, as required.

`git diff --check` passed. Playwright stopped its preview server; no listener
remained on port 4173.

## Remaining Concerns

- The documented ExcelJS transitive audit findings remain.
- Vite reports existing chunks above 500 kB for heavy document/chart/Excel
  dependencies; the initial entry remains comfortably within its enforced
  budget.
- The two item 14 test/refactor deferrals remain exactly as approved.

No other known merge-blocking concern remains. No push, merge, SSH,
deployment, or forced dependency downgrade was performed.
