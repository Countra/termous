import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PRODUCT_TOUR_VERSION,
  buildProductTourLabels,
  buildProductTourSteps,
} from './productTourSteps.ts'
import { productTourTopics } from './productTourTopics.ts'

const translate = (key: string) => key

test('专题引导使用独立内容版本', () => {
  assert.equal(PRODUCT_TOUR_VERSION, 5)
})

test('核心使用向导按页面集中介绍功能', () => {
  const steps = buildProductTourSteps(translate)

  assert.deepEqual(steps.filter((step) => !['remote-desktop', 'agent', 'account'].includes(step.route ?? '') && !['settingsModels', 'notifications'].includes(step.id)).map((step) => step.id), [
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
  assert.equal(steps[steps.length - 1].id, 'finish')
  assert.equal(steps[steps.length - 1].element, undefined)
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

  assert.deepEqual(steps.slice(0, 27).filter((step) => step.disableActiveInteraction).map((step) => step.id), [
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

test('专题步骤唯一、完整且不允许在讲解期间触发业务操作', () => {
  const catalog = buildProductTourSteps(translate)
  const referenced = new Set<string>()
  assert.equal(new Set(catalog.map((step) => step.id)).size, catalog.length)
  for (const topic of productTourTopics) {
    const steps = buildProductTourSteps(translate, topic.id)
    assert.deepEqual(steps.map((step) => step.id), topic.steps)
    assert.equal(new Set(topic.steps).size, steps.length)
    assert.ok(steps.every((step) => step.disableActiveInteraction))
    steps.forEach((step) => referenced.add(step.id))
  }
  assert.deepEqual([...referenced].sort(), catalog.map((step) => step.id).sort())
  assert.ok(buildProductTourSteps(translate, 'basics').length <= 15)
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

test('基础导览与连接专题先介绍凭据，再介绍主机', () => {
  for (const topic of ['basics', 'connections'] as const) {
    const ids = buildProductTourSteps(translate, topic).map((step) => step.id)
    assert.ok(ids.indexOf('vaultNav') >= 0, topic)
    assert.ok(ids.indexOf('vaultNav') < ids.indexOf('hostsNav'), topic)
  }
})

test('专题提供返回列表与完成并返回，保留底层全览的跳过语义', () => {
  for (const { id } of productTourTopics) {
    const labels = buildProductTourLabels(translate, id)
    assert.equal(labels.skip, 'productTour.backToTopics', id)
    assert.equal(labels.done, 'productTour.finishTopic', id)
  }
})
