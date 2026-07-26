# El Bill Operational Audit Follow-ups

**Goal:** Apply the P0/P1 findings from the 2026-07-26 deployed-product audit without removing the existing automatic-diagnosis workflow.

## Task 1: Recommendation eligibility and calculation consistency

- Force candidates with a different contract type or voltage to `추가 검토 필요`.
- Keep the dashboard savings KPI on the same calculation result used by diagnosis and documents.
- Add regression tests for both behaviors.

## Task 2: Absolute TTL and sample privacy

- Preserve the original 24-hour expiry when stored data is updated.
- Start a new TTL only after explicit reset or a new upload session.
- Remove residual customer-number and location detail from public sample data.
- Add storage regression tests.

## Task 3: Document readiness and submission safeguards

- Allow change-application exports only for a completed `변경 추천` result using an eligible candidate.
- Render checklist readiness from actual available/generated evidence.
- Mark every application preview as a non-official drafting aid.
- Add unit and component coverage.

## Task 4: Upload guardrails and pending preview

- Reject oversized files and excessive row counts before analysis.
- Convert parser failures into user guidance.
- Distinguish newly parsed rows from the currently applied dataset.
- Make recognition confidence describe structural/data completeness rather than an unconditional 100%.

## Task 5: Peak operation detail

- Enumerate all configured main-building and annex EHP groups with five-minute start times.
- Show tariff peak windows alongside cafeteria and special-room operating windows.
- Add deterministic unit tests.

## Task 6: Verification and deployment

- Update README and calculation notes.
- Run typecheck, lint, unit tests, build, and Chromium E2E.
- Commit and push the audit branch, integrate to main, deploy through the configured NAS/Cloudflare path, and smoke-test production.
