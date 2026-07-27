import { expect, test, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import JSZip from 'jszip'

const billMonths = Array.from({ length: 36 }, (_, index) => {
  const monthIndex = 2023 * 12 + 7 + index
  return [Math.floor(monthIndex / 12), (monthIndex % 12) + 1] as const
})

const powerPlannerBillRows = billMonths
  .map(([year, month], index) => {
    const usage = 46_000 + index * 900
    const amount = 6_900_000 + index * 135_000
    const appliedPower = 490 + (index % 6)
    return `
      <tr role="row">
        <td title="${year}년 ${String(month).padStart(2, '0')}월" aria-describedby="grid_YEAR_ROW">${year}년 ${String(month).padStart(2, '0')}월</td>
        <td title="${appliedPower}" aria-describedby="grid_JOJ_KW">${appliedPower}</td>
        <td title="${usage.toLocaleString('en-US')}" aria-describedby="grid_F_AP_QT">${usage.toLocaleString('en-US')}</td>
        <td title="${amount.toLocaleString('en-US')}" aria-describedby="grid_TOT_REQ_AMT">${amount.toLocaleString('en-US')}</td>
      </tr>`
  })
  .join('')

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
      <tbody>${powerPlannerBillRows}</tbody>
    </table>
  </body>
</html>`

const storageMutationLockName = 'el-bill:storage-mutation'
const billDraftPointerKey = 'el-bill:bill-entry-draft-active'
const standardBillCsvHeader =
  '연도,월,사용량(kWh),총 전기요금(원),요금적용전력(kW),최대수요전력(kW),기본요금(원),전력량요금(원),역률요금(원),기후환경요금(원),연료비조정액(원),부가세(원),전력산업기반기금(원),메모'
const personalBillMonths = Array.from({ length: 12 }, (_, index) => {
  const monthIndex = 2025 * 12 + 7 + index
  return {
    year: Math.floor(monthIndex / 12),
    month: (monthIndex % 12) + 1,
    usageKwh: 48_000 + index * 750,
    totalBillWon: 7_100_000 + index * 112_500,
  }
})
const pastedBillText = [
  '연도\t월\t사용량(kWh)\t총 전기요금(원)',
  ...personalBillMonths.map(
    ({ year, month, usageKwh, totalBillWon }) =>
      `${year}\t${month}\t${usageKwh}\t${totalBillWon}`,
  ),
].join('\n')
const manualBillMatrix = [...personalBillMonths]
  .reverse()
  .map(({ usageKwh, totalBillWon }) => `${usageKwh}\t${totalBillWon}`)
  .join('\n')

const clearBrowserStorage = async (page: Page) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
}

const expectBillDraftStorageRemoved = async (page: Page) => {
  await expect
    .poll(() =>
      page.evaluate((pointerKey) => ({
        pointer: localStorage.getItem(pointerKey),
        generations: Array.from(
          { length: localStorage.length },
          (_, index) => localStorage.key(index),
        ).filter((key) =>
          key?.startsWith('el-bill:bill-entry-draft:v1:'),
        ),
      }), billDraftPointerKey),
    )
    .toEqual({ pointer: null, generations: [] })
}

const openDesktopView = async (page: Page, name: string) => {
  await page.locator('.sidebar-nav').getByRole('button', { name, exact: true }).click()
}

const assertNoHorizontalOverlap = async (
  leftLocator: ReturnType<Page['locator']>,
  rightLocator: ReturnType<Page['locator']>,
) => {
  const [left, right] = await Promise.all([
    leftLocator.boundingBox(),
    rightLocator.boundingBox(),
  ])
  expect(left).not.toBeNull()
  expect(right).not.toBeNull()
  expect(left!.x + left!.width).toBeLessThanOrEqual(right!.x)
}

const readActiveStorageState = (page: Page) =>
  page.evaluate(() => {
    const pointerRaw = localStorage.getItem('el-bill:storage-active')
    if (!pointerRaw) return null
    const pointer = JSON.parse(pointerRaw) as { sessionId: string }
    const snapshotRaw = localStorage.getItem(
      `el-bill:storage-snapshot:${encodeURIComponent(pointer.sessionId)}`,
    )
    if (!snapshotRaw) return null
    const snapshot = JSON.parse(snapshotRaw) as {
      revision: number
      data: {
        profile: { displaySchoolName: string }
        scenario: { targetPeakKw: number }
      }
    }
    return {
      revision: snapshot.revision,
      schoolName: snapshot.data.profile.displaySchoolName,
      targetPeakKw: snapshot.data.scenario.targetPeakKw,
    }
  })

test('production preview serves hashed entry and lazy chunks', async ({ page }) => {
  await page.goto('/')

  const entryScript = await page
    .locator('script[type="module"][src]')
    .getAttribute('src')
  expect(entryScript).toMatch(/^\/assets\/index-[A-Za-z0-9_-]+\.js$/)

  await page.locator('.sidebar-nav').getByRole('button', {
    name: '고지서 입력',
    exact: true,
  }).click()
  await expect(page.getByRole('heading', { name: '고지서 업로드' })).toBeVisible()

  const scriptAssets = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => /\/assets\/.+\.js$/.test(name)),
  )
  expect(scriptAssets.length).toBeGreaterThan(1)
  expect(
    scriptAssets.every((name) =>
      /\/assets\/[A-Za-z0-9_-]+-[A-Za-z0-9_-]+\.js$/.test(name),
    ),
  ).toBe(true)
})

test('checked-in synthetic XLSX reaches recognized mapping and analysis state', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()

  await page.getByRole('button', { name: '전기요금 자동진단 시작' }).click()
  await page.getByRole('button', { name: '자료 업로드부터 시작' }).click()
  await page
    .locator('input[type="file"][accept=".xlsx,.xls"]')
    .first()
    .setInputFiles(resolve('e2e/fixtures/monthly-bills.xlsx'))

  await expect(page.getByRole('heading', { name: '자동 인식 결과' })).toBeVisible()
  await expect(
    page.locator('.recognition-grid article').filter({ hasText: '필수 컬럼' }),
  ).toContainText('연도, 월, 사용량, 총 전기요금')
  await expect(page.getByRole('heading', { name: '새 입력 데이터' })).toBeVisible()

  await page.getByRole('button', { name: '이 데이터로 분석 시작' }).click()
  await expect(page.locator('.view-heading h2')).toHaveText('자동진단')
  await expect(page.getByText('파일 업로드 고지서 분석', { exact: false })).toBeVisible()
})

test('tariff-full calculation mode persists into diagnosis and documents after reload', async ({
  page,
}) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()

  await page.locator('.sidebar-nav').getByRole('button', {
    name: '고지서 입력',
    exact: true,
  }).click()
  await page
    .locator('input[type="file"][accept=".xlsx,.xls"]')
    .first()
    .setInputFiles(resolve('e2e/fixtures/monthly-bills.xlsx'))
  await page.getByRole('button', { name: '이 데이터로 분석 시작' }).click()

  await page.locator('.sidebar-nav').getByRole('button', {
    name: '설정',
    exact: true,
  }).click()
  await page.getByText('요금표 기반 전체 추정', { exact: true }).click()
  await page.getByLabel('기후환경요금 단가(원/kWh)').fill('10')
  await expect
    .poll(() =>
      page.evaluate(() => {
        const pointerRaw = localStorage.getItem('el-bill:storage-active')
        if (!pointerRaw) return null
        const { sessionId } = JSON.parse(pointerRaw) as { sessionId: string }
        const raw = localStorage.getItem(
          `el-bill:storage-snapshot:${encodeURIComponent(sessionId)}`,
        )
        if (!raw) return null
        return (
          JSON.parse(raw) as {
            data: {
              calculationSettings: {
                mode: string
                climateEnvironmentWonPerKwh: number
              }
            }
          }
        ).data.calculationSettings
      }),
    )
    .toEqual({
      mode: 'tariffFull',
      climateEnvironmentWonPerKwh: 10,
      fuelAdjustmentWonPerKwh: -5,
      vatPercent: 10,
      fundPercent: 3.7,
    })

  await page.reload()
  await page.locator('.sidebar-nav').getByRole('button', {
    name: '설정',
    exact: true,
  }).click()
  await expect(
    page.getByRole('radio', { name: '요금표 기반 전체 추정' }),
  ).toBeChecked()
  await expect(page.getByLabel('기후환경요금 단가(원/kWh)')).toHaveValue('10')

  await page.locator('.sidebar-nav').getByRole('button', {
    name: '자동진단',
    exact: true,
  }).click()
  await expect(
    page.getByText('요금표 기반 전체 추정', { exact: true }).first(),
  ).toBeVisible()

  await page.locator('.sidebar-nav').getByRole('button', {
    name: '문서생성',
    exact: true,
  }).click()
  await expect(
    page.getByText(/계산 모드: 요금표 기반 전체 추정/),
  ).toBeVisible()
  await expect(page.getByText(/기후환경요금 단가: 10원\/kWh/)).toBeVisible()
})

test('two tabs merge different active-session edits under Web Locks', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()

  await page.locator('.sidebar-nav').getByRole('button', {
    name: '고지서 입력',
    exact: true,
  }).click()
  await page
    .locator('input[type="file"][accept=".xlsx,.xls"]')
    .first()
    .setInputFiles(resolve('e2e/fixtures/monthly-bills.xlsx'))
  await page.getByRole('button', { name: '이 데이터로 분석 시작' }).click()
  await expect(page.getByText('고지서: 파일 업로드', { exact: true })).toBeVisible()

  const secondPage = await page.context().newPage()
  await secondPage.goto('/')
  await expect(
    secondPage.getByText('고지서: 파일 업로드', { exact: true }),
  ).toBeVisible()
  expect(
    await page.evaluate(() => typeof navigator.locks?.request),
  ).toBe('function')
  expect(
    await secondPage.evaluate(() => typeof navigator.locks?.request),
  ).toBe('function')

  await page.locator('.sidebar-nav').getByRole('button', {
    name: '학교정보',
    exact: true,
  }).click()
  await secondPage.locator('.sidebar-nav').getByRole('button', {
    name: '피크관리',
    exact: true,
  }).click()

  await page.getByLabel('화면 표시명').fill('교차 탭 학교')
  await expect
    .poll(() => readActiveStorageState(page))
    .toEqual({
      revision: 1,
      schoolName: '교차 탭 학교',
      targetPeakKw: 500,
    })

  await page.evaluate((lockName) => {
    const testWindow = window as typeof window & {
      __elBillLockAcquired?: boolean
      __elBillLockRelease?: () => void
      __elBillLockPromise?: Promise<void>
    }
    testWindow.__elBillLockAcquired = false
    testWindow.__elBillLockPromise = navigator.locks.request(
      lockName,
      { mode: 'exclusive' },
      async () => {
        testWindow.__elBillLockAcquired = true
        await new Promise<void>((resolve) => {
          testWindow.__elBillLockRelease = resolve
        })
      },
    )
  }, storageMutationLockName)
  await expect
    .poll(() =>
      page.evaluate(() => {
        const testWindow = window as typeof window & {
          __elBillLockAcquired?: boolean
        }
        return testWindow.__elBillLockAcquired
      }),
    )
    .toBe(true)

  await secondPage.getByLabel('목표 피크(kW)').fill('611')
  await expect
    .poll(() =>
      secondPage.evaluate(async (lockName) => {
        const state = await navigator.locks.query()
        return {
          held: state.held?.some((lock) => lock.name === lockName) ?? false,
          pending:
            state.pending?.some((lock) => lock.name === lockName) ?? false,
        }
      }, storageMutationLockName),
    )
    .toEqual({
      held: true,
      pending: true,
    })
  expect(await readActiveStorageState(page)).toEqual({
    revision: 1,
    schoolName: '교차 탭 학교',
    targetPeakKw: 500,
  })

  await page.evaluate(() => {
    const testWindow = window as typeof window & {
      __elBillLockRelease?: () => void
    }
    testWindow.__elBillLockRelease?.()
  })
  await expect
    .poll(() => readActiveStorageState(page))
    .toEqual({
      revision: 2,
      schoolName: '교차 탭 학교',
      targetPeakKw: 611,
    })
  await page.evaluate(async () => {
    const testWindow = window as typeof window & {
      __elBillLockPromise?: Promise<void>
    }
    await testWindow.__elBillLockPromise
  })

  await secondPage.close()
})

test('two tabs merge concurrent PowerPlanner uploads without losing bill or profile data', async ({
  page,
}, testInfo) => {
  const uploadA = testInfo.outputPath('power-planner-a.csv')
  const uploadB = testInfo.outputPath('power-planner-b.csv')
  await writeFile(
    uploadA,
    ['일자,시간,사용량(kWh)', '2026-07-01,13,420'].join('\n'),
  )
  await writeFile(
    uploadB,
    ['일자,시간,사용량(kWh)', '2026-07-01,14,460'].join('\n'),
  )

  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.locator('.sidebar-nav').getByRole('button', {
    name: '고지서 입력',
    exact: true,
  }).click()
  await page
    .locator('input[type="file"][accept=".xlsx,.xls"]')
    .first()
    .setInputFiles(resolve('e2e/fixtures/monthly-bills.xlsx'))
  await page.getByRole('button', { name: '이 데이터로 분석 시작' }).click()
  await page.locator('.sidebar-nav').getByRole('button', {
    name: '학교정보',
    exact: true,
  }).click()
  await page.getByLabel('화면 표시명').fill('동시 업로드 학교')
  const billCountBeforeUploads = await page.evaluate(() => {
    const pointer = JSON.parse(
      localStorage.getItem('el-bill:storage-active') ?? 'null',
    ) as { sessionId: string } | null
    if (!pointer) return 0
    const snapshot = JSON.parse(
      localStorage.getItem(
        `el-bill:storage-snapshot:${encodeURIComponent(pointer.sessionId)}`,
      ) ?? 'null',
    ) as { data: { bills: unknown[] } } | null
    return snapshot?.data.bills.length ?? 0
  })
  expect(billCountBeforeUploads).toBeGreaterThan(0)

  const secondPage = await page.context().newPage()
  await secondPage.goto('/')
  for (const currentPage of [page, secondPage]) {
    await currentPage.locator('.sidebar-nav').getByRole('button', {
      name: '파워플래너',
      exact: true,
    }).click()
  }
  await page
    .locator('input[type="file"][accept=".xlsx,.xls,.csv"]')
    .setInputFiles(uploadA)
  await secondPage
    .locator('input[type="file"][accept=".xlsx,.xls,.csv"]')
    .setInputFiles(uploadB)

  await page.evaluate((lockName) => {
    const testWindow = window as typeof window & {
      __plannerLockRelease?: () => void
      __plannerLockPromise?: Promise<void>
    }
    testWindow.__plannerLockPromise = navigator.locks.request(
      lockName,
      { mode: 'exclusive' },
      async () =>
        new Promise<void>((resolve) => {
          testWindow.__plannerLockRelease = resolve
        }),
    )
  }, storageMutationLockName)
  await expect
    .poll(() =>
      page.evaluate(async (lockName) => {
        const state = await navigator.locks.query()
        return state.held?.some((lock) => lock.name === lockName) ?? false
      }, storageMutationLockName),
    )
    .toBe(true)

  await page.getByRole('button', { name: '매핑 적용' }).click()
  await secondPage.getByRole('button', { name: '매핑 적용' }).click()
  await expect
    .poll(() =>
      page.evaluate(async (lockName) => {
        const state = await navigator.locks.query()
        return state.pending?.filter((lock) => lock.name === lockName).length ?? 0
      }, storageMutationLockName),
    )
    .toBe(2)

  await page.evaluate(() => {
    const testWindow = window as typeof window & {
      __plannerLockRelease?: () => void
    }
    testWindow.__plannerLockRelease?.()
  })
  await expect(page.locator('.view-heading h2')).toHaveText('자동진단')
  await expect(secondPage.locator('.view-heading h2')).toHaveText('자동진단')
  await expect
    .poll(() =>
      page.evaluate(() => {
        const pointer = JSON.parse(
          localStorage.getItem('el-bill:storage-active') ?? 'null',
        ) as { sessionId: string } | null
        if (!pointer) return null
        const snapshot = JSON.parse(
          localStorage.getItem(
            `el-bill:storage-snapshot:${encodeURIComponent(pointer.sessionId)}`,
          ) ?? 'null',
        ) as {
          data: {
            bills: unknown[]
            profile: { displaySchoolName: string }
            powerPlanner: { records: Array<{ hour: number }> }
            provenance: { bills: string; powerPlanner: string }
          }
        } | null
        if (!snapshot) return null
        return {
          billCount: snapshot.data.bills.length,
          schoolName: snapshot.data.profile.displaySchoolName,
          hours: snapshot.data.powerPlanner.records
            .map((record) => record.hour)
            .sort(),
          provenance: snapshot.data.provenance,
        }
      }),
    )
    .toEqual({
      billCount: billCountBeforeUploads,
      schoolName: '동시 업로드 학교',
      hours: [13, 14],
      provenance: {
        bills: 'uploaded',
        powerPlanner: 'uploaded',
      },
    })
  await page.evaluate(async () => {
    const testWindow = window as typeof window & {
      __plannerLockPromise?: Promise<void>
    }
    await testWindow.__plannerLockPromise
  })
  await secondPage.close()
})

test('PowerPlanner-only upload stays sample-bill mode', async ({ page }, testInfo) => {
  const powerPlannerCsv = testInfo.outputPath('power-planner-hourly.csv')
  await writeFile(
    powerPlannerCsv,
    [
      '일자,시간,사용량(kWh)',
      '2026-07-01,13,420',
      '2026-07-01,14,460',
    ].join('\n'),
  )

  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()

  await page.locator('.sidebar-nav').getByRole('button', { name: '파워플래너', exact: true }).click()
  await page.locator('input[type="file"][accept=".xlsx,.xls,.csv"]').setInputFiles(powerPlannerCsv)
  await page.getByRole('button', { name: '매핑 적용' }).click()

  await expect(page.getByText('고지서: 시연 샘플', { exact: true })).toBeVisible()
  await expect(page.getByText('파워플래너: 사용자 업로드', { exact: true })).toBeVisible()

  await page.locator('.sidebar-nav').getByRole('button', { name: '문서생성', exact: true }).click()
  await expect(page.getByRole('button', { name: 'PDF 미리보기' }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: '전체 다운로드 (ZIP)' })).toBeDisabled()
  await expect(page.getByText('사용자 고지서 업로드 후 생성 가능', { exact: true })).toBeVisible()
})

test('PowerPlanner file replaces a demo sample and clearing it preserves bill origin', async ({ page }, testInfo) => {
  const powerPlannerCsv = testInfo.outputPath('power-planner-hourly.csv')
  await writeFile(
    powerPlannerCsv,
    [
      '일자,시간,사용량(kWh)',
      '2026-07-01,13,420',
      '2026-07-01,14,460',
    ].join('\n'),
  )

  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.locator('.sidebar-nav').getByRole('button', { name: '파워플래너', exact: true }).click()
  await page.getByRole('button', { name: '시연 샘플 적용' }).click()
  await page.locator('.sidebar-nav').getByRole('button', { name: '파워플래너', exact: true }).click()
  await expect(page.locator('.power-summary-grid article').first()).toContainText('25건')

  await page.locator('input[type="file"][accept=".xlsx,.xls,.csv"]').setInputFiles(powerPlannerCsv)
  await page.getByRole('button', { name: '매핑 적용' }).click()
  await page.locator('.sidebar-nav').getByRole('button', { name: '파워플래너', exact: true }).click()
  await expect(page.locator('.power-summary-grid article').first()).toContainText('2건')
  await expect(page.getByText('파워플래너: 사용자 업로드', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '업로드 자료 초기화' }).click()
  await expect(page.getByText('고지서: 시연 샘플', { exact: true })).toBeVisible()
  await expect(page.getByText('파워플래너: 미사용', { exact: true })).toBeVisible()
})

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
  await expect(page.locator('.diagnosis-status-card')).toContainText(
    '진단 완료',
  )
  await expect(page.locator('.diagnosis-status-card')).toContainText(
    '고지서 출처: 시연 샘플',
  )
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
  await expect(page.getByRole('heading', { name: '새 입력 데이터' })).toBeVisible()
  await expect(page.getByText('아직 적용 전')).toBeVisible()
  await expect(page.getByRole('heading', { name: '현재 적용 데이터' })).toBeVisible()
  await page.getByRole('button', { name: '이 데이터로 분석 시작' }).click()
  await expectViewHeading('자동진단')
  await expect(page.getByText('파일 업로드 고지서 분석', { exact: false })).toBeVisible()
  await expect(page.getByText('고지서: 파일 업로드', { exact: true })).toBeVisible()
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

  await clickSidebar('학교정보')
  await page.getByLabel('화면 표시명').fill('테스트고등학교2026')
  await clickSidebar('문서생성')
  await expectViewHeading('변경신청 패키지 자동 생성')
  await expect(page.locator('#plan-preview .doc-masthead strong')).toHaveText('테스트고등학교2026')
  await page.getByRole('button', { name: '변경신청서' }).click()
  await expect(page.locator('#application-preview.visible')).toBeVisible()
  await expect(page.getByText('자동 입력 가능 항목과 수기 확인 필요 항목을 구분했습니다.')).toBeVisible()

  const zipDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '전체 다운로드 (ZIP)' }).click()
  const downloadedZip = await zipDownload
  const documentStem = '테스트고등학교2026'
  await expect(downloadedZip.suggestedFilename()).toBe(`${documentStem}_전기요금_변경_문서묶음.zip`)
  const zipPath = testInfo.outputPath('document-package.zip')
  await downloadedZip.saveAs(zipPath)
  const zip = await JSZip.loadAsync(await readFile(zipPath))
  expect(Object.keys(zip.files)).toEqual(
    expect.arrayContaining([
      `${documentStem}_전기요금제_변경계획안.pdf`,
      `${documentStem}_한전_제출공문.pdf`,
      `${documentStem}_전기사용계약_변경신청서_미리보기.pdf`,
      `${documentStem}_계산근거_요약표.txt`,
      `${documentStem}_계산근거_분해표.json`,
      `${documentStem}_담당자_검토필요항목.txt`,
      `${documentStem}_변경신청서_자동입력항목.json`,
    ]),
  )
  const expectedPdfNames = [
    `${documentStem}_전기요금제_변경계획안.pdf`,
    `${documentStem}_한전_제출공문.pdf`,
    `${documentStem}_전기사용계약_변경신청서_미리보기.pdf`,
  ]
  const zipPdfNames = Object.keys(zip.files).filter((name) => name.endsWith('.pdf'))
  expect(zipPdfNames).toHaveLength(3)
  expect(zipPdfNames).toEqual(expect.arrayContaining(expectedPdfNames))
  for (const expectedPdfName of expectedPdfNames) {
    const entry = zip.file(expectedPdfName)
    expect(entry).toBeTruthy()
    const bytes = await entry!.async('uint8array')
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('%PDF')
    expect(bytes.byteLength).toBeGreaterThan(100_000)
  }

  for (const [index, expectedPdfName] of expectedPdfNames.entries()) {
    const pdfDownload = page.waitForEvent('download')
    await page.getByRole('button', { name: '다운로드' }).nth(index).click()
    const downloadedPdf = await pdfDownload
    await expect(downloadedPdf.suggestedFilename()).toBe(expectedPdfName)
    const pdfPath = testInfo.outputPath(`document-${index}.pdf`)
    await downloadedPdf.saveAs(pdfPath)
    const pdfBytes = await readFile(pdfPath)
    expect(pdfBytes.subarray(0, 4).toString()).toBe('%PDF')
    expect(pdfBytes.byteLength).toBeGreaterThan(100_000)
  }
})

test('invalid peak target is rejected', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()

  await page.locator('.sidebar-nav').getByRole('button', { name: '피크관리', exact: true }).click()
  await page.getByLabel('목표 피크(kW)').fill('0')
  await page.getByLabel('예상 피크(kW)').fill('-1')

  await expect(page.getByLabel('목표 피크(kW)')).toHaveValue('500')
  await expect(page.getByLabel('예상 피크(kW)')).toHaveValue('485')
  await expect(page.getByText('위험도', { exact: true })).toBeVisible()
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

test('pasted bill rows apply through automatic diagnosis', async ({ page }) => {
  await clearBrowserStorage(page)
  await openDesktopView(page, '고지서 입력')

  await page.getByRole('tab', { name: '직접 입력' }).click()
  await page.getByRole('button', {
    name: '최근 12개월 입력행 생성',
  }).click()
  await expect
    .poll(() =>
      page.evaluate((pointerKey) => localStorage.getItem(pointerKey), billDraftPointerKey),
    )
    .not.toBeNull()

  await page.getByRole('tab', { name: '표 붙여넣기' }).click()
  await page.getByLabel('붙여넣을 표').fill(pastedBillText)
  await page.getByRole('button', { name: '붙여넣은 표 확인' }).click()

  await expect(page.getByText('12개월을 인식했습니다.')).toBeVisible()
  await expect(page.getByRole('heading', { name: '새 입력 데이터' })).toBeVisible()
  await expect(page.getByLabel('입력 데이터 요약')).toContainText('붙여넣은 표')
  await page.getByRole('button', { name: '이 데이터로 분석 시작' }).click()

  await expect(page.locator('.view-heading h2')).toHaveText('자동진단')
  await expectBillDraftStorageRemoved(page)
  await expect(page.getByText('고지서: 표 붙여넣기', { exact: true })).toBeVisible()
  await expect(page.getByText('표 붙여넣기 고지서 분석', { exact: false })).toBeVisible()
})

test('manual bill multi-cell draft restores before apply', async ({ page }) => {
  await clearBrowserStorage(page)
  await openDesktopView(page, '고지서 입력')

  await page.getByRole('tab', { name: '직접 입력' }).click()
  await page.getByLabel('마지막 청구월').fill('2026-07')
  await page.getByRole('button', { name: '최근 12개월 입력행 생성' }).click()
  await page.getByLabel('2026-07 사용량(kWh)').evaluate((input, matrix) => {
    const transfer = new DataTransfer()
    transfer.setData('text/plain', matrix)
    input.dispatchEvent(
      new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      }),
    )
  }, manualBillMatrix)

  await expect(page.getByRole('heading', { name: '새 입력 데이터' })).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate((pointerKey) => {
        const pointerRaw = localStorage.getItem(pointerKey)
        if (!pointerRaw) return null
        const pointer = JSON.parse(pointerRaw) as {
          sessionId: string
          generationId?: string
        }
        const baseKey =
          `el-bill:bill-entry-draft:v1:${encodeURIComponent(pointer.sessionId)}`
        const activeKey = pointer.generationId
          ? `${baseKey}:${encodeURIComponent(pointer.generationId)}`
          : baseKey
        const draftRaw = localStorage.getItem(activeKey)
        if (!draftRaw) return null
        const draft = JSON.parse(draftRaw) as {
          rows?: Array<{
            yearMonth: string
            usageKwh: string
            totalBillWon: string
          }>
        }
        if (!draft.rows) return null
        const july = draft.rows.find((row) => row.yearMonth === '2026-07')
        const august = draft.rows.find((row) => row.yearMonth === '2025-08')
        const persistedValues = (
          row:
            | {
                yearMonth: string
                usageKwh: string
                totalBillWon: string
              }
            | undefined,
        ) =>
          row
            ? {
                yearMonth: row.yearMonth,
                usageKwh: row.usageKwh,
                totalBillWon: row.totalBillWon,
              }
            : null
        return {
          rowCount: draft.rows.length,
          july: persistedValues(july),
          august: persistedValues(august),
        }
      }, billDraftPointerKey),
    )
    .toEqual({
      rowCount: 12,
      july: {
        yearMonth: '2026-07',
        usageKwh: '56250',
        totalBillWon: '8337500',
      },
      august: {
        yearMonth: '2025-08',
        usageKwh: '48000',
        totalBillWon: '7100000',
      },
    })

  await page.reload()
  await openDesktopView(page, '고지서 입력')
  await page.getByRole('tab', { name: '직접 입력' }).click()

  await expect(page.getByText('이전 입력 초안을 복원했습니다.')).toBeVisible()
  await expect(page.getByLabel('2026-07 사용량(kWh)')).toHaveValue('56,250')
  await expect(page.getByRole('heading', { name: '새 입력 데이터' })).toBeVisible()
  await page.getByRole('button', { name: '이 데이터로 분석 시작' }).click()

  await expect(page.locator('.view-heading h2')).toHaveText('자동진단')
  await expectBillDraftStorageRemoved(page)
  await expect(page.getByText('고지서: 직접 입력', { exact: true })).toBeVisible()
  await expect(page.getByText('직접 입력 고지서 분석', { exact: false })).toBeVisible()
})

test('usage guide copies prompt and downloads an exact BOM CSV template', async ({
  context,
  page,
}, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await clearBrowserStorage(page)
  await openDesktopView(page, '사용 안내')

  await page.getByRole('button', { name: 'GPT 변환 프롬프트 복사' }).click()
  await expect(page.getByRole('status')).toContainText('프롬프트를 복사했습니다.')
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('원본에 없는 값은 계산하거나 추측하지 마세요.')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '표준 CSV 양식 다운로드' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('el-bill-import.csv')
  const downloadPath = testInfo.outputPath('el-bill-import.csv')
  await download.saveAs(downloadPath)
  const bytes = await readFile(downloadPath)

  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  expect(bytes.subarray(3).toString('utf8').split(/\r?\n/, 1)[0]).toBe(
    standardBillCsvHeader,
  )
})

test('expired bill draft is physically removed after reload', async ({ page }) => {
  await clearBrowserStorage(page)
  await openDesktopView(page, '고지서 입력')
  await page.getByRole('tab', { name: '직접 입력' }).click()
  await page.getByRole('button', { name: '최근 12개월 입력행 생성' }).click()

  const draftKey = await expect
    .poll(() =>
      page.evaluate((pointerKey) => {
        const pointerRaw = localStorage.getItem(pointerKey)
        if (!pointerRaw) return null
        const pointer = JSON.parse(pointerRaw) as {
          sessionId: string
          generationId?: string
        }
        return Array.from({ length: localStorage.length }, (_, index) =>
          localStorage.key(index),
        ).find(
          (key) =>
            key?.startsWith(
              `el-bill:bill-entry-draft:v1:${encodeURIComponent(pointer.sessionId)}`,
            ) && (!pointer.generationId || key.endsWith(encodeURIComponent(pointer.generationId))),
        ) ?? null
      }, billDraftPointerKey),
    )
    .not.toBeNull()
    .then(() =>
      page.evaluate((pointerKey) => {
        const pointer = JSON.parse(localStorage.getItem(pointerKey) ?? 'null') as {
          sessionId: string
          generationId?: string
        }
        return Array.from({ length: localStorage.length }, (_, index) =>
          localStorage.key(index),
        ).find(
          (key) =>
            key?.startsWith(
              `el-bill:bill-entry-draft:v1:${encodeURIComponent(pointer.sessionId)}`,
            ) && (!pointer.generationId || key.endsWith(encodeURIComponent(pointer.generationId))),
        )!
      }, billDraftPointerKey),
    )

  await page.evaluate((key) => {
    const draft = JSON.parse(localStorage.getItem(key) ?? 'null') as {
      createdAt: string
      expiresAt: string
    }
    const expiresAt = Date.now() - 60_000
    draft.createdAt = new Date(expiresAt - 60 * 60 * 1000).toISOString()
    draft.expiresAt = new Date(expiresAt).toISOString()
    localStorage.setItem(key, JSON.stringify(draft))
  }, draftKey)

  await page.reload()
  await openDesktopView(page, '고지서 입력')
  await page.getByRole('tab', { name: '직접 입력' }).click()

  await expect
    .poll(() =>
      page.evaluate(
        ({ key, pointerKey }) => ({
          draft: localStorage.getItem(key),
          pointer: localStorage.getItem(pointerKey),
        }),
        { key: draftKey, pointerKey: billDraftPointerKey },
      ),
    )
    .toEqual({ draft: null, pointer: null })
})

test('mobile personal input tabs and guide navigation do not overlap', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await clearBrowserStorage(page)

  await page.getByRole('button', { name: '주요 메뉴 열기' }).click()
  await page.locator('.sidebar-nav').getByRole('button', {
    name: '고지서 입력',
    exact: true,
  }).click()

  const inputTabs = page.getByRole('tablist', { name: '고지서 입력 방식' })
  const fileTab = inputTabs.getByRole('tab', { name: '파일 업로드' })
  const pasteTab = inputTabs.getByRole('tab', { name: '표 붙여넣기' })
  const manualTab = inputTabs.getByRole('tab', { name: '직접 입력' })
  await assertNoHorizontalOverlap(fileTab, pasteTab)
  await assertNoHorizontalOverlap(pasteTab, manualTab)

  await pasteTab.click()
  await expect(page.getByRole('tabpanel', { name: '표 붙여넣기' })).toBeVisible()
  await manualTab.click()
  await expect(page.getByRole('tabpanel', { name: '직접 입력' })).toBeVisible()
  await fileTab.click()
  await expect(page.getByRole('tabpanel', { name: '파일 업로드' })).toBeVisible()
  await manualTab.click()
  await page.getByRole('button', { name: '입력 안내' }).click()

  const manualGuideHeading = page.getByRole('heading', {
    name: '최근 12개월 직접 입력',
  })
  await expect(manualGuideHeading).toBeFocused()
  const guideSelect = page.getByLabel('안내 항목 선택')
  const guideMove = page.getByRole('button', { name: '이동' })
  await assertNoHorizontalOverlap(guideSelect, guideMove)
  await guideSelect.selectOption('gpt-csv')
  await guideMove.click()
  await expect(page.getByRole('heading', { name: 'GPT로 CSV 변환' })).toBeFocused()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
})
