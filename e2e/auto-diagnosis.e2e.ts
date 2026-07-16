import { expect, test } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import JSZip from 'jszip'

const powerPlannerHtmlFixture = `
<html>
  <body>
    <table class="ui-jqgrid-htable">
      <thead>
        <tr>
          <th id="grid_YEAR_ROW"><div>연월</div></th>
          <th id="grid_JOJ_KW"><div>요금적용전력(kW)</div></th>
          <th id="grid_F_AP_QT"><div>사용전력량(kWh)</div></th>
          <th id="grid_TOT_REQ_AMT"><div>청구요금(원)</div></th>
        </tr>
      </thead>
    </table>
    <table class="ui-jqgrid-btable">
      <tbody>
        <tr role="row">
          <td title="2026년 06월" aria-describedby="grid_YEAR_ROW">2026년 06월</td>
          <td title="493" aria-describedby="grid_JOJ_KW">493</td>
          <td title="48,365" aria-describedby="grid_F_AP_QT">48,365</td>
          <td title="7,138,790" aria-describedby="grid_TOT_REQ_AMT">7,138,790</td>
        </tr>
        <tr role="row">
          <td title="2026년 07월" aria-describedby="grid_YEAR_ROW">2026년 07월</td>
          <td title="498" aria-describedby="grid_JOJ_KW">498</td>
          <td title="50,120" aria-describedby="grid_F_AP_QT">50,120</td>
          <td title="7,421,000" aria-describedby="grid_TOT_REQ_AMT">7,421,000</td>
        </tr>
      </tbody>
    </table>
  </body>
</html>`

test('automatic diagnosis flow remains usable end to end', async ({ page }, testInfo) => {
  const billXls = testInfo.outputPath('power-planner-bill.xls')
  const powerPlannerCsv = testInfo.outputPath('power-planner-monthly.csv')
  await writeFile(billXls, powerPlannerHtmlFixture)
  await writeFile(
    powerPlannerCsv,
    [
      '연월,사용전력량(kWh),청구요금(원),요금적용전력(kW)',
      '2026년 06월,48365,7138790,493',
      '2026년 07월,50120,7421000,498',
    ].join('\n'),
  )
  const expectViewHeading = async (name: string) => {
    await expect(page.locator('.view-heading h2').filter({ hasText: name })).toBeVisible()
  }
  const clickSidebar = async (name: string) => {
    await page.locator('.sidebar-nav').getByRole('button', { name, exact: true }).click()
  }

  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()

  await expectViewHeading('통합 대시보드')
  await expect(page.getByText('시연 샘플', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '전기요금 자동진단 시작' }).click()
  await expectViewHeading('자동진단')

  await page.getByRole('button', { name: '자료 업로드부터 시작' }).click()
  await expectViewHeading('월별 한전고지서 입력')
  await page.locator('input[type="file"][accept=".xlsx,.xls"]').first().setInputFiles(billXls)
  await expect(page.getByRole('heading', { name: '자동 인식 결과' })).toBeVisible()
  await expect(
    page.locator('.recognition-grid article').filter({ hasText: '필수 컬럼' }),
  ).toContainText('연도, 월, 사용량, 총 전기요금')
  await expect(
    page.locator('.recognition-grid article').filter({ hasText: '누락 컬럼' }),
  ).toContainText('없음')
  await page.getByRole('button', { name: '이 매핑으로 분석 시작' }).click()
  await expectViewHeading('자동진단')
  await expect(page.getByText('사용자 업로드 분석', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '계산 근거 분해' })).toBeVisible()

  await clickSidebar('파워플래너')
  await page.locator('input[type="file"][accept=".xlsx,.xls,.csv"]').setInputFiles(powerPlannerCsv)
  await expect(
    page.getByText('파일을 읽었습니다. 데이터 유형과 컬럼 매핑을 확인해 주세요.'),
  ).toBeVisible()
  await page.getByRole('button', { name: '매핑 적용' }).click()
  await expectViewHeading('자동진단')
  await clickSidebar('파워플래너')
  await expect(page.getByLabel('업로드 데이터 유형')).toHaveValue('monthlyUsage')

  await clickSidebar('피크관리')
  await page.getByLabel('본관 EHP 그룹 수').fill('8')
  await expect(page.getByText('본관 EHP 8개 그룹')).toBeVisible()

  await clickSidebar('요금제 비교')
  await page.getByLabel('예상 최대수요전력(kW)').fill('650')
  await page.getByRole('button', { name: '시뮬레이션 설정' }).click()
  await clickSidebar('피크관리')
  await expect(page.getByText('본관 EHP 8개 그룹')).toBeVisible()
  await expect(page.getByLabel('예상 피크(kW)')).toHaveValue('650')

  await clickSidebar('문서생성')
  await expectViewHeading('변경신청 패키지 자동 생성')
  await page.getByRole('button', { name: '변경신청서' }).click()
  await expect(page.locator('#application-preview.visible')).toBeVisible()
  await expect(page.getByText('자동 입력 가능 항목과 수기 확인 필요 항목을 구분했습니다.')).toBeVisible()

  const zipDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '전체 다운로드 (ZIP)' }).click()
  const downloadedZip = await zipDownload
  await expect(downloadedZip.suggestedFilename()).toContain('.zip')
  const zipPath = testInfo.outputPath('document-package.zip')
  await downloadedZip.saveAs(zipPath)
  const zip = await JSZip.loadAsync(await readFile(zipPath))
  expect(Object.keys(zip.files)).toEqual(
    expect.arrayContaining([
      '전기요금제_변경계획안.pdf',
      '한전_제출공문.pdf',
      '전기사용계약_변경신청서_미리보기.pdf',
    ]),
  )
  const zippedPlanPdf = await zip.file('전기요금제_변경계획안.pdf')?.async('uint8array')
  expect(new TextDecoder().decode(zippedPlanPdf?.slice(0, 4))).toBe('%PDF')
  expect(zippedPlanPdf?.byteLength).toBeGreaterThan(100_000)

  const pdfDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '다운로드' }).first().click()
  const downloadedPdf = await pdfDownload
  await expect(downloadedPdf.suggestedFilename()).toContain('.pdf')
  const pdfPath = testInfo.outputPath('plan.pdf')
  await downloadedPdf.saveAs(pdfPath)
  const planPdfBytes = await readFile(pdfPath)
  expect(planPdfBytes.subarray(0, 4).toString()).toBe('%PDF')
  expect(planPdfBytes.byteLength).toBeGreaterThan(100_000)
})

test('mobile core workflow keeps navigation and wide content usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()

  const menuButton = page.getByRole('button', { name: '주요 메뉴 열기' })
  await expect(menuButton).toBeVisible()
  await expect(menuButton).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('.sidebar-nav')).not.toBeVisible()

  await menuButton.click()
  await expect(page.getByRole('button', { name: '주요 메뉴 닫기' })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await page.locator('.sidebar-nav').getByRole('button', { name: '자동진단' }).click()
  await expect(page.locator('.sidebar-nav')).not.toBeVisible()

  await expect(page.getByText('표를 좌우로 밀어 전체 후보를 확인하세요.')).toBeVisible()

  await page.getByRole('button', { name: '주요 메뉴 열기' }).click()
  await page.locator('.sidebar-nav').getByRole('button', { name: '문서생성' }).click()
  await page.getByRole('button', { name: '변경신청서' }).click()
  await expect(page.getByText('문서를 좌우로 밀어 원본 크기로 확인하세요.')).toBeVisible()

  const previewSize = await page.locator('.document-preview-stage').evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }))
  expect(previewSize.scrollWidth).toBeGreaterThan(previewSize.clientWidth)
  expect(previewSize.scrollWidth).toBeGreaterThanOrEqual(680)
})
