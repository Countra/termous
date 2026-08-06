import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  completionProviderIds,
  completionProviderSettingsSignature,
  completionSettingsEqual,
  defaultCompletionSettings,
  hasEnabledCompletionProvider,
  normalizeCompletionSettings,
} from '#entities/settings'
import { normalizeSettings } from '../features/settings/model/settings.ts'

const settingsViewSource = readFileSync(
  fileURLToPath(new URL('../features/settings/ui/terminal/TerminalCompletionSettings.tsx', import.meta.url)),
  'utf8',
)
const dataSource = readFileSync(
  fileURLToPath(new URL('../app/useTermousData.ts', import.meta.url)),
  'utf8',
)

test('旧设置缺少智能补全字段时默认开启', () => {
  const settings = normalizeSettings({
    language: 'zh-CN',
  })

  assert.deepEqual(settings.completion, defaultCompletionSettings)
})

test('智能补全显式关闭不会被兼容默认值覆盖', () => {
  assert.deepEqual(normalizeCompletionSettings({ enabled: false }), {
    enabled: false,
    providers: {
      native: true,
      alias: true,
      snippet: true,
      history: true,
      directory: true,
    },
  })
})

test('旧设置缺少来源配置时默认启用全部固定来源', () => {
  const normalized = normalizeCompletionSettings({ enabled: true })

  assert.deepEqual(completionProviderIds, ['native', 'alias', 'snippet', 'history', 'directory'])
  assert.deepEqual(normalized.providers, {
    native: true,
    alias: true,
    snippet: true,
    history: true,
    directory: true,
  })
})

test('来源显式关闭与缺失来源可同时正确归一化', () => {
  const normalized = normalizeCompletionSettings({
    enabled: true,
    providers: {
      history: false,
      directory: false,
    },
  })

  assert.deepEqual(normalized.providers, {
    native: true,
    alias: true,
    snippet: true,
    history: false,
    directory: false,
  })
  assert.equal(completionProviderSettingsSignature(normalized.providers), '11100')
  assert.equal(completionSettingsEqual(normalized, { ...normalized }), true)
  assert.equal(completionSettingsEqual(normalized, {
    ...normalized,
    providers: { ...normalized.providers, alias: false },
  }), false)
})

test('全部补全来源关闭时可直接识别为无查询配置', () => {
  const providers = {
    native: false,
    alias: false,
    snippet: false,
    history: false,
    directory: false,
  }

  assert.equal(hasEnabledCompletionProvider(providers), false)
  assert.equal(hasEnabledCompletionProvider({ ...providers, native: true }), true)
})

test('补全来源使用可展开设置并串行提交写请求', () => {
  assert.match(settingsViewSource, /<Collapse/)
  assert.match(settingsViewSource, /completionProviderIds\.map/)
  assert.match(settingsViewSource, /pendingKeysRef\.current\.size > 0/)
  assert.match(settingsViewSource, /disabled=\{disabled \|\| !value\.enabled \|\| pendingKeys\.size > 0\}/)
})

test('补全设置只允许最新 mutation 应用响应或回滚', () => {
  assert.match(dataSource, /completionSettingsWriteQueue\.enqueue/)
  assert.match(dataSource, /completionSettingsMutationRef\.current !== mutation/)
  assert.match(dataSource, /completionSettingsEqual\(current\.settings\.completion, completion\)/)
  assert.match(dataSource, /completionSettingsConfirmedRef\.current = settings\.completion/)
  assert.match(dataSource, /const confirmedCompletion = completionSettingsConfirmedRef\.current/)
  assert.match(dataSource, /canApplyReloadedValue\(/)
  assert.doesNotMatch(dataSource, /completionSettingsRef\.current = previousCompletion/)
})
