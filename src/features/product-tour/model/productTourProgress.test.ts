import assert from 'node:assert/strict'
import test from 'node:test'
import { createProductTourProgress } from './productTourProgress.ts'
import { PRODUCT_TOUR_STORAGE_KEY, hasCompletedCurrentProductTour } from './productTourStorage.ts'
import { PRODUCT_TOUR_VERSION } from './productTourSteps.ts'

function memoryStorage() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
}

test('旧版导览记录阻止重复自动导览，专题保持独立', () => {
  const storage = memoryStorage()
  storage.setItem(PRODUCT_TOUR_STORAGE_KEY, '4')
  const progress = createProductTourProgress(() => storage)
  assert.equal(progress.shouldOfferBasics(), false)
  assert.equal(hasCompletedCurrentProductTour(progress.forTopic('automation')), false)
  progress.forTopic('automation').writeCompletedVersion(PRODUCT_TOUR_VERSION)
  assert.equal(hasCompletedCurrentProductTour(progress.forTopic('automation')), true)
  assert.equal(hasCompletedCurrentProductTour(progress.forTopic('agent')), false)
  assert.equal(storage.getItem(PRODUCT_TOUR_STORAGE_KEY), '4')
})

test('看过基础导览即可停止自动提示，不伪造专题完成状态', () => {
  const storage = memoryStorage()
  const progress = createProductTourProgress(() => storage)
  assert.equal(progress.shouldOfferBasics(), true)
  progress.markBasicsSeen()
  assert.equal(createProductTourProgress(() => storage).shouldOfferBasics(), false)
  assert.equal(hasCompletedCurrentProductTour(progress.forTopic('basics')), false)
})

test('存储不可用时仍可使用向导且本次不重复自动提示', () => {
  const progress = createProductTourProgress(() => { throw new Error('不可用') })
  assert.equal(progress.shouldOfferBasics(), true)
  progress.markBasicsSeen()
  assert.equal(progress.shouldOfferBasics(), false)
  assert.equal(progress.forTopic('agent').writeCompletedVersion(PRODUCT_TOUR_VERSION), false)
})
