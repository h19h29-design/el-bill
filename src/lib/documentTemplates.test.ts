import { describe, expect, it } from 'vitest'
import { defaultScenario, defaultSchoolProfile, sampleBills } from '../data/sampleBills'
import { buildDocumentBundle, rateChangeCaution } from './documentTemplates'

const comparison = {
  currentAnnualWon: 66_589_800,
  candidateAnnualWon: 63_260_310,
  savingWon: 3_329_490,
  savingRate: 0.05,
  threeYearSavingWon: 9_988_470,
  fiveYearSavingWon: 16_647_450,
  recommendation: '변경 추천' as const,
  basis: '테스트',
}

describe('document template harness', () => {
  it('includes the one-change-per-year caution in generated documents', () => {
    const bundle = buildDocumentBundle(
      defaultSchoolProfile,
      sampleBills.at(-1),
      comparison,
      defaultScenario,
    )

    expect(bundle.planText).toContain(rateChangeCaution)
    expect(bundle.kepcoLetterText).toContain(rateChangeCaution)
    expect(bundle.applicationPreviewData.신중검토안내).toBe(rateChangeCaution)
  })
})
