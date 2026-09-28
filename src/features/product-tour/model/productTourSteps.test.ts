import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PRODUCT_TOUR_VERSION,
  buildProductTourLabels,
  buildProductTourSteps,
} from './productTourSteps.ts'

const translate = (key: string) => key

test('挂载、审计与 Skills 扩展使用向导内容版本 4', () => {
  assert.equal(PRODUCT_TOUR_VERSION, 4)
})

test('核心使用向导按页面集中介绍功能', () => {
  const steps = buildProductTourSteps(translate)

  assert.deepEqual(steps.map((step) => step.id), [
    'welcome',
    'vaultNav',
    'vaultActions',
    'credentialEditor',
    'hostsNav',
    'hostEditor',
    'hostConnections',
    'fileProfiles',
    'topbarConnect',
    'workbench',
    'workbenchTools',
    'files',
    'filesBookmarks',
    'filesLocalDirectory',
    'filesTransfers',
    'mounts',
    'mountsRuntime',
    'forwards',
    'snippets',
    'audit',
    'settings',
    'settingsTerminal',
    'settingsMount',
    'settingsMcp',
    'settingsSkills',
    'settingsAgent',
    'settingsData',
    'finish',
  ])
  assert.match(steps.find((step) => step.id === 'vaultNav')?.element ?? '', /nav-vault/)
  assert.match(steps.find((step) => step.id === 'hostConnections')?.element ?? '', /host-connection-catalog/)
  assert.match(steps.find((step) => step.id === 'workbenchTools')?.element ?? '', /workbench-tools/)
  assert.match(steps.find((step) => step.id === 'files')?.element ?? '', /files-workspace/)
  assert.match(steps.find((step) => step.id === 'forwards')?.element ?? '', /forwards-overview/)
  assert.match(steps.find((step) => step.id === 'snippets')?.element ?? '', /snippets-workspace/)
  assert.match(steps.find((step) => step.id === 'settings')?.element ?? '', /settings-workspace/)
  assert.equal(steps[steps.length - 1].route, 'settings')
  assert.match(steps[steps.length - 1].element ?? '', /product-tour-trigger/)
})

test('文件入口介绍不触发准备动作，设置仅定位激活面板', () => {
  const steps = buildProductTourSteps(translate)
  for (const step of steps.filter((step) => ['files', 'mounts', 'audit'].includes(step.route ?? ''))) {
    assert.equal(step.preparation, undefined, step.id)
  }
  for (const step of steps.filter((step) => step.preparation?.startsWith('settings'))) {
    assert.equal(step.route, 'settings')
    assert.match(step.element ?? '', /\[role="tabpanel"\]\[aria-hidden="false"\]/)
  }
})

test('新增功能与设置步骤仅作讲解，凭据与主机等步骤保持原行为', () => {
  const steps = buildProductTourSteps(translate)

  assert.deepEqual(steps.filter((step) => step.disableActiveInteraction).map((step) => step.id), [
    'fileProfiles',
    'mounts',
    'mountsRuntime',
    'audit',
    'settingsTerminal',
    'settingsMount',
    'settingsMcp',
    'settingsSkills',
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
