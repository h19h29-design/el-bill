# El Bill Reliability Improvements Design

## Objective

Make the deployed MVP trustworthy enough for a school administrator to upload real data, review a diagnosis, and download a submission package without encountering contradictory recognition results, misleading sample state, broken PDFs, or unusable mobile layouts.

## Design Direction

Use a reliability-first sequence. Preserve the existing blue public-sector visual system and menu structure, but fix the generated artifacts and data-state communication before broader visual polish.

## Document Generation

- Generate PDF blobs through one reusable helper instead of triggering browser saves directly from each card.
- Add explicit page-break rules so paragraphs, tables, and footer cautions are not sliced between A4 pages.
- Avoid trailing blank pages by removing fixed minimum heights from the export clone.
- Build the ZIP from the three generated PDFs plus the calculation and review support files.
- Keep the one-year tariff-change caution in every generated document.

## Upload Recognition

- Treat `autoRows` as a successful structured recognition result.
- Derive recognized years and required-column coverage from the normalized rows when sheet mappings are not used.
- Never show `100%` confidence beside `필수 컬럼 없음` and `누락 컬럼 4개`.
- Show the number of normalized records so the user understands what will be analyzed.

## Power Planner

- Keep the applied data type visible when the user returns to the screen.
- Avoid mapping one source column to unrelated date fields. A combined `연월` column maps to `date`; `year` and `month` remain empty unless separate columns exist.
- Summaries expose imported data types and make the absence of hourly data explicit.

## Sample And Real Data State

- Continue to provide sample data for contest demonstrations.
- Clearly label the initial state as `시연 샘플` instead of presenting it as a completed real upload.
- Change reset copy to explain that it restores sample data.
- After real bill upload, switch the state to user-uploaded data and retain the 24-hour deletion notice.

## Mobile

- Replace the permanently expanded mobile sidebar with a compact menu toggle and collapsible navigation.
- Add a horizontal-scroll cue for the TOP 3 tariff table.
- Present document previews in a horizontally scrollable A4 viewport with a readable minimum page width rather than shrinking the document to 292 px.
- Preserve keyboard labels and visible focus states.

## Verification

- Unit tests cover normalized recognition summaries, Power Planner mapping, and PDF/ZIP file composition helpers.
- Component/E2E tests cover sample-state labels, mobile menu behavior, data-type persistence, ZIP contents, and generated PDF page quality.
- Final gates: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`, `npm run test:e2e`, followed by a production smoke test.

