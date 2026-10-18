import assert from 'node:assert/strict'
import test from 'node:test'
import {
  defaultConnectionSettings,
  normalizeConnectionSettings,
} from '#entities/settings'
import { normalizeSettings } from '../features/settings/model/settings.ts'

test('旧设置缺少连接可靠性字段时保持默认关闭', () => {
  const settings = normalizeSettings({
    language: 'zh-CN',
  })

  assert.deepEqual(settings.connection, defaultConnectionSettings)
})

test('旧连接设置补齐十分钟默认值，越界值不会进入界面', () => {
  assert.equal(normalizeConnectionSettings({ remote_desktop_auto_reconnect_enabled: false }).rdp_unattended_timeout_minutes, 10)
  for (const value of [0, 31, 1.5, Number.NaN]) {
    assert.equal(normalizeConnectionSettings({ rdp_unattended_timeout_minutes: value }).rdp_unattended_timeout_minutes, 10)
  }
  for (const value of [1, 10, 30]) {
    assert.equal(normalizeConnectionSettings({ rdp_unattended_timeout_minutes: value }).rdp_unattended_timeout_minutes, value)
  }
})

test('连接可靠性开关的显式值不会被兼容默认值覆盖', () => {
  const settings = normalizeSettings({
    connection: {
      ssh_keepalive_enabled: true,
      forward_auto_reconnect_enabled: true,
      remote_desktop_auto_reconnect_enabled: false,
      rdp_unattended_timeout_minutes: 20,
    },
  })

  assert.deepEqual(settings.connection, {
    ssh_keepalive_enabled: true,
    forward_auto_reconnect_enabled: true,
    remote_desktop_auto_reconnect_enabled: false,
    rdp_unattended_timeout_minutes: 20,
  })
})
