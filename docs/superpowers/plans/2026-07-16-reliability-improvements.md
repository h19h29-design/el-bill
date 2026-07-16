# El Bill Reliability Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the deployed MVP's submission artifacts, data-recognition trust issues, sample-state communication, and mobile core workflow.

**Architecture:** Extract deterministic document-export and ZIP composition helpers from the React component, enrich recognition summaries from normalized data, and keep UI state derived from persisted sources. Apply responsive changes within the existing component and CSS system.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library, Playwright, html2pdf.js, JSZip.

## Global Constraints

- Keep all existing features.
- Do not add KEPCO login, crawling, or unofficial API calls.
- Keep browser-local parsing and 24-hour TTL deletion.
- Keep school identity anonymized as A고등학교.
- Keep the internal-estimate disclaimer and one-year tariff-change caution.
- Preserve the existing public-sector blue, white, and teal visual system.

---

### Task 1: Fix Recognition And Power Planner Mapping

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/diagnosis.ts`
- Modify: `src/lib/diagnosis.test.ts`
- Modify: `src/lib/powerPlanner.ts`
- Modify: `src/lib/powerPlanner.test.ts`
- Modify: `src/components/bills/BillUpload.tsx`
- Modify: `src/components/powerPlanner/PowerPlannerUpload.tsx`

**Interfaces:**
- `summarizeWorkbookRecognition(result, mapping)` returns normalized record count and consistent required/missing columns.
- `guessPowerPlannerMapping(headers)` maps a combined date column only to `date`.

- [ ] Add failing tests for `autoRows` recognition coverage and non-duplicated Power Planner mapping.
- [ ] Run focused tests and verify the new assertions fail.
- [ ] Implement normalized recognition fields and mapping behavior.
- [ ] Persist the applied Power Planner type in the upload screen.
- [ ] Run focused tests and verify they pass.

### Task 2: Build Reliable PDF And ZIP Artifacts

**Files:**
- Create: `src/lib/documentExport.ts`
- Create: `src/lib/documentExport.test.ts`
- Modify: `src/components/docs/DocumentGenerator.tsx`
- Modify: `src/styles.css`
- Modify: `src/types/html2pdf.d.ts`
- Modify: `e2e/auto-diagnosis.e2e.ts`

**Interfaces:**
- `createPdfBlob(element: HTMLElement): Promise<Blob>` creates an A4 PDF blob with page-break rules.
- `createDocumentPackage(bundle, pdfFiles): Promise<Blob>` returns a ZIP containing three PDFs and support files.

- [ ] Add failing unit tests for required ZIP filenames.
- [ ] Add failing E2E assertions that inspect ZIP entries and PDF page counts.
- [ ] Implement blob-based PDF generation and shared export options.
- [ ] Add CSS page-break protections and remove export-only minimum heights.
- [ ] Generate all three PDFs before composing the ZIP.
- [ ] Run unit and E2E tests and verify artifact structure.

### Task 3: Clarify Sample And Uploaded Data State

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/types.ts`
- Modify: `src/components/dashboard/Dashboard.tsx`
- Modify: `src/components/diagnosis/AutoDiagnosis.tsx`
- Modify: `src/components/layout/TopNotice.tsx`
- Modify: `e2e/auto-diagnosis.e2e.ts`

**Interfaces:**
- App-level `dataMode` is either `sample` or `uploaded`.
- Diagnosis and dashboard status cards receive the data mode and label sample results explicitly.

- [ ] Add failing component/E2E assertions for the initial `시연 샘플` label and uploaded-state transition.
- [ ] Implement the app-level data mode and reset behavior.
- [ ] Update dashboard, diagnosis, and notice copy.
- [ ] Run focused tests and verify the state transition.

### Task 4: Make The Core Workflow Usable On Mobile

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/components/diagnosis/AutoDiagnosis.tsx`
- Modify: `src/components/docs/DocumentGenerator.tsx`
- Modify: `src/styles.css`
- Modify: `e2e/auto-diagnosis.e2e.ts`

**Interfaces:**
- Sidebar exposes a mobile menu button with `aria-expanded`.
- Wide data tables and A4 previews expose visible scroll guidance and stable minimum dimensions.

- [ ] Add failing mobile E2E assertions for collapsed navigation, scroll guidance, and readable document preview width.
- [ ] Implement the mobile menu and responsive styles.
- [ ] Add candidate-table and preview scroll cues.
- [ ] Run mobile E2E checks at 390 x 844.

### Task 5: Verify, Document, Commit, Push, And Deploy

**Files:**
- Modify: `README.md`
- Modify: `docs/deployment.md`

- [ ] Document the reliable document package and sample/uploaded state.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run test`.
- [ ] Run `npm run build`.
- [ ] Run `npm run test:e2e`.
- [ ] Run a production artifact smoke test.
- [ ] Commit and push `codex/reliability-fixes`.
- [ ] Merge or fast-forward to `main` after verification.
- [ ] Deploy using the configured NAS/Cloudflare path discoverable from the local environment.
- [ ] Verify `https://el-bill.h19h19.com/` serves the new asset hashes and repeat the production smoke flow.

