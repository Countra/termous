import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PRODUCT_TOUR_STORAGE_KEY,
  createProductTourCompletionStore,
  hasCompletedCurrentProductTour,
  parseCompletedVersion,
} from './productTourStorage.ts'
import { PRODUCT_TOUR_VERSION } from './productTourSteps.ts'

test('安全解析向导完成版本并拒绝损坏值', () => {
  assert.equal(parseCompletedVersion(null), null)
  assert.equal(parseCompletedVersion(''), null)
  assert.equal(parseCompletedVersion('1'), 1)
  assert.equal(parseCompletedVersion(' 2 '), 2)
  assert.equal(parseCompletedVersion('-1'), null)
  assert.equal(parseCompletedVersion('1x'), null)
  assert.equal(parseCompletedVersion('1.5'), null)
  assert.equal(parseCompletedVersion('0x1'), null)
  assert.equal(parseCompletedVersion('1e0'), null)
  assert.equal(parseCompletedVersion('+1'), null)
  assert.equal(parseCompletedVersion('01'), null)
})

test('使用固定键读写版本，并区分旧版、当前版与更高版本', () => {
  const values = new Map<string, string>()
  const store = createProductTourCompletionStore(() => ({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
  }))

  assert.equal(hasCompletedCurrentProductTour(store), false)
  assert.equal(store.writeCompletedVersion(PRODUCT_TOUR_VERSION - 1), true)
  assert.equal(hasCompletedCurrentProductTour(store), false)
  assert.equal(store.writeCompletedVersion(PRODUCT_TOUR_VERSION), true)
  assert.equal(values.get(PRODUCT_TOUR_STORAGE_KEY), String(PRODUCT_TOUR_VERSION))
  assert.equal(hasCompletedCurrentProductTour(store), true)
  assert.equal(store.writeCompletedVersion(PRODUCT_TOUR_VERSION + 1), true)
  assert.equal(hasCompletedCurrentProductTour(store), true)
})

test('本地存储不可用时读写均安全降级', () => {
  const store = createProductTourCompletionStore(() => {
    throw new Error('storage unavailable')
  })

  assert.equal(store.readCompletedVersion(), null)
  assert.equal(store.writeCompletedVersion(PRODUCT_TOUR_VERSION), false)
  assert.equal(hasCompletedCurrentProductTour(store), false)
})
