import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PRODUCT_TOUR_VERSION,
  buildProductTourLabels,
  buildProductTourSteps,
} from './productTourSteps.ts'

const translate = (key: string) => key

test('扩展后的核心使用向导使用内容版本 2', () => {
  assert.equal(PRODUCT_TOUR_VERSION, 2)
})

test('核心使用向导固定为十五步且保持关键锚点顺序', () => {
  const steps = buildProductTourSteps(translate)

  assert.deepEqual(steps.map((step) => step.id), [
    'welcome',
    'vaultNav',
    'vaultActions',
    'credentialEditor',
    'hostsNav',
    'hostEditor',
    'hostConnections',
    'topbarConnect',
    'workbench',
    'workbenchTools',
    'files',
    'forwards',
    'snippets',
    'settings',
    'finish',
  ])
  assert.match(steps[1].element ?? '', /nav-vault/)
  assert.match(steps[6].element ?? '', /host-connection-catalog/)
  assert.match(steps[9].element ?? '', /workbench-tools/)
  assert.match(steps[10].element ?? '', /files-workspace/)
  assert.match(steps[11].element ?? '', /forwards-overview/)
  assert.match(steps[12].element ?? '', /snippets-workspace/)
  assert.match(steps[13].element ?? '', /settings-workspace/)
  assert.match(steps[14].element ?? '', /product-tour-trigger/)
  assert.equal(steps[14].route, 'settings')
})

test('Driver 文案保留进度占位符', () => {
  const labels = buildProductTourLabels((key, options) => (
    key === 'productTour.progress'
      ? `${String(options?.current)} / ${String(options?.total)}`
      : key
  ))

  assert.equal(labels.progress, '{{current}} / {{total}}')
  assert.equal(labels.skip, 'productTour.skip')
  assert.equal(labels.close, 'productTour.close')
})
