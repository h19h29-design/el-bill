# Exceptional Final Fix Report - Cross-Tab Draft Identity Safety

Date: 2026-07-27

Worktree:
`/Users/mac-mini/Documents/전기요금/.worktrees/personal-data-entry-guide`

Branch: `codex/personal-data-entry-guide`

Reviewed base: `365c4aff29a28f1e73c387f0655a1fdaba941293`

Commit: the single focused commit containing this report

## Result

The cross-tab draft identity flaw is fixed. A stale persistence result now
puts the manual draft lifecycle into an explicit terminal conflict state.
The lifecycle never reads or adopts another tab's draft identity after a
failed removal, and transient non-stale failures retain the lifecycle's
original CAS revision and identity.

While conflicted, queued and later writes are blocked, removal is not retried,
apply/remove calls return an honest `conflict` result, and the user's rows stay
in component state. Manual input and apply-preview status surfaces give the
same Korean instruction to reload or reopen before continuing.

No draft storage format, TTL, privacy boundary, parsing behavior, inference
rule, applied-data snapshot behavior, or unrelated UI was changed.

## TDD Evidence

### Lifecycle And Manual Input RED

The required focused command was run before production changes:

```text
npx vitest run src/components/bills/manualBillDraftLifecycle.test.ts src/components/bills/ManualBillInput.test.tsx
```

RED result: 5 failed, 29 passed (34 total).

The failures proved that the previous implementation:

- returned `remove-failed` instead of `conflict` for stale apply removal;
- allowed a later edit to write after stale removal;
- returned `write-failed` instead of `conflict` for a stale write;
- called `read` and adopted a newer identity after transient removal failure;
- rendered generic removal failure copy instead of cross-tab guidance.

The unsafe test
`keeps a new edit after failed removal and retries from the refreshed identity`
was removed and replaced with safety regressions.

### Apply Preview RED

Self-review found that BillUpload's visible preview still told a conflicted
user to retry, contradicting the terminal reload/reopen guidance. A focused
integration test was added before changing that consumer:

```text
npx vitest run src/components/bills/BillUpload.test.tsx -t "requires reload after a cross-tab draft conflict blocks apply cleanup"
```

RED result: 1 failed, 13 skipped. The preview contained the generic
`다시 시도해 주세요` removal message instead of the cross-tab conflict
instruction.

### GREEN

- Required lifecycle/manual focused suite: 34/34 passed.
- Expanded lifecycle/manual/BillUpload focused suite: 48/48 passed.
- Full unit suite: 627/627 passed across 39 files.

## Implemented Behavior

### 1. Identity Preservation

`refreshIdentity()` is removed from the lifecycle's failure paths. Neither a
stale removal nor a storage/lock failure reads current storage state. The
original revision and complete identity remain unchanged.

Regression coverage asserts that injected `read` functions are never called
after stale or transient removal failure.

### 2. Explicit Conflict State

The lifecycle now exposes `conflict` through:

- `ManualBillDraftLifecycleStatus`;
- `ManualBillDraftPrepareResult`;
- `ManualBillDraftCompleteResult`;
- `ManualBillDraftRemoveResult`.

Both stale writes and stale removals enter the same terminal state.

### 3. Persistence Blocking

Entering conflict clears the debounce timer and pending snapshot. Conflict
checks prevent:

- a queued edit made while removal is in flight from being written;
- any later scheduled edit from being written;
- apply preparation or completion from proceeding;
- direct removal or removal retry from touching persistence.

The stale-removal regression confirms that persistence receives only the
original identity once and is not called again.

### 4. Transient Failure CAS Safety

Storage and lock failures remain retryable. They do not enter conflict and do
not refresh identity. A regression performs a failed removal followed by a
successful retry and asserts that both calls use the same original identity.

### 5. Row Retention And Reader Copy

Conflict does not mutate `ManualBillInput` rows. Integration coverage creates
a newer cross-tab draft, forces stale apply cleanup, and confirms:

- the original local row remains visible;
- the newer storage generation remains untouched;
- navigation does not occur;
- both manual status and apply preview instruct the user that another tab
  changed the draft and to reload or reopen.

The shared reader copy is:

```text
다른 탭에서 입력 초안이 변경되었습니다. 계속하려면 화면을 새로고침하거나 다시 열어 주세요.
```

## Existing Behavior Coverage

Focused lifecycle tests continue to cover:

- successful pending-write flush and exact CAS removal;
- waiting for an in-flight write before apply;
- honest failed write and failed removal results;
- an edit made during successful in-flight removal;
- apply cancellation without draft deletion;
- disposal canceling pending and future persistence.

BillUpload coverage continues to distinguish transient removal failure, which
remains retryable, from terminal cross-tab conflict, which requires reload.

## Files Changed

- `src/components/bills/manualBillDraftLifecycle.ts`
- `src/components/bills/manualBillDraftLifecycle.test.ts`
- `src/components/bills/ManualBillInput.tsx`
- `src/components/bills/ManualBillInput.test.tsx`
- `src/components/bills/BillUpload.tsx`
- `src/components/bills/BillUpload.test.tsx`
- this report

## Verification

```text
npx vitest run src/components/bills/manualBillDraftLifecycle.test.ts src/components/bills/ManualBillInput.test.tsx
PASS: 2 files, 34 tests

npx vitest run src/components/bills/manualBillDraftLifecycle.test.ts src/components/bills/ManualBillInput.test.tsx src/components/bills/BillUpload.test.tsx
PASS: 3 files, 48 tests

npm run typecheck
PASS: tsc -b

npm run lint
PASS: oxlint

npm test
PASS: 39 files, 627 tests
```

`git diff --check` passed during self-review. No dev or test server was
started. No push, merge, SSH, or deployment action was performed.

## Self-Review

- No production call to `persistence.read` remains in the lifecycle.
- Stale results take precedence over concurrent local-change reporting so the
  lifecycle cannot remain retryable after observing another generation.
- Conflict is checked before queued writes, after waiting on an in-flight
  write, and before apply/removal persistence.
- Successful and transient-failure paths retain their prior behavior.
- The lifecycle keeps local UI rows separate from blocked persistence work.
- The diff is limited to lifecycle state, its two visible consumers, focused
  tests, and this report.

## Remaining Concerns

No new scoped concern remains. Previously documented whole-branch concerns
and explicit deferrals are unchanged by this exceptional fix.
