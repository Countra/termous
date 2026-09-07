import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PRODUCT_TOUR_VERSION,
  buildProductTourLabels,
  buildProductTourSteps,
} from './productTourSteps.ts'

const translate = (key: string) => key

test('文件与设置扩展使用向导内容版本 3', () => {
  assert.equal(PRODUCT_TOUR_VERSION, 3)
})

test('核心使用向导保持二十二步且按页面集中介绍功能', () => {
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
    'filesBookmarks',
    'filesLocalDirectory',
    'filesTransfers',
    'forwards',
    'snippets',
    'settings',
    'settingsTerminal',
    'settingsMcp',
    'settingsAgent',
    'settingsData',
    'finish',
  ])
  assert.match(steps[1].element ?? '', /nav-vault/)
  assert.match(steps[6].element ?? '', /host-connection-catalog/)
  assert.match(steps[9].element ?? '', /workbench-tools/)
  assert.match(steps[10].element ?? '', /files-workspace/)
  assert.match(steps[14].element ?? '', /forwards-overview/)
  assert.match(steps[15].element ?? '', /snippets-workspace/)
  assert.match(steps[16].element ?? '', /settings-workspace/)
  assert.match(steps[21].element ?? '', /product-tour-trigger/)
  assert.equal(steps[21].route, 'settings')
})

test('文件入口介绍不触发准备动作，设置仅定位激活面板', () => {
  const steps = buildProductTourSteps(translate)
  for (const step of steps.filter((step) => step.route === 'files')) {
    assert.equal(step.preparation, undefined, step.id)
  }
  for (const step of steps.filter((step) => step.preparation?.startsWith('settings'))) {
    assert.equal(step.route, 'settings')
    assert.match(step.element ?? '', /\[role="tabpanel"\]\[aria-hidden="false"\]/)
  }
})

test('仅四个新增设置步骤限制表单交互，凭据与主机等步骤保持原行为', () => {
  const steps = buildProductTourSteps(translate)

  assert.deepEqual(steps.filter((step) => step.disableActiveInteraction).map((step) => step.id), [
    'settingsTerminal',
    'settingsMcp',
    'settingsAgent',
    'settingsData',
  ])
  for (const id of ['credentialEditor', 'hostEditor', 'hostConnections', 'settings']) {
    assert.equal(steps.find((step) => step.id === id)?.disableActiveInteraction ?? false, false, id)
  }
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
