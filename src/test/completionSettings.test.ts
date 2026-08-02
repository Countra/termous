import assert from 'node:assert/strict'
import test from 'node:test'
import {
  defaultCompletionSettings,
  normalizeCompletionSettings,
  normalizeSettings,
} from '../features/settings/terminalSettings.ts'

test('旧设置缺少智能补全字段时默认开启', () => {
  const settings = normalizeSettings({
    language: 'zh-CN',
  })

  assert.deepEqual(settings.completion, defaultCompletionSettings)
})

test('智能补全显式关闭不会被兼容默认值覆盖', () => {
  assert.deepEqual(normalizeCompletionSettings({ enabled: false }), {
    enabled: false,
  })
})
