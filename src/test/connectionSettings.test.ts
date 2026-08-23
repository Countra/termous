import assert from 'node:assert/strict'
import test from 'node:test'
import {
  defaultConnectionSettings,
} from '#entities/settings'
import { normalizeSettings } from '../features/settings/model/settings.ts'

test('旧设置缺少连接可靠性字段时保持默认关闭', () => {
  const settings = normalizeSettings({
    language: 'zh-CN',
  })

  assert.deepEqual(settings.connection, defaultConnectionSettings)
})

test('连接可靠性开关的显式值不会被兼容默认值覆盖', () => {
  const settings = normalizeSettings({
    connection: {
      ssh_keepalive_enabled: true,
      forward_auto_reconnect_enabled: true,
    },
  })

  assert.deepEqual(settings.connection, {
    ssh_keepalive_enabled: true,
    forward_auto_reconnect_enabled: true,
  })
})
