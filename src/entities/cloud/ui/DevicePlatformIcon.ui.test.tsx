import { render, screen } from '@testing-library/react'
import { beforeAll, expect, test } from 'vitest'
import { changeLanguage } from '#shared/i18n'
import { decodeCloudDevice } from '../model/decode'
import { DevicePlatformIcon } from './DevicePlatformIcon'

beforeAll(async () => { await changeLanguage('zh-CN') })

test('平台标识统一显示，未知及旧缓存使用通用设备图标', () => {
  const device = { id: 'fixture', user_id: 'owner', name: '设备', signing_key: '', recipient: '', status: 'pending', created_at: '2026-11-07T00:00:00Z' }
  for (const platform of ['windows', 'linux', 'darwin', 'android'] as const) {
    expect(decodeCloudDevice({ ...device, platform }).platform).toBe(platform)
  }
  expect(decodeCloudDevice(device).platform).toBe('unknown')
  expect(decodeCloudDevice({ ...device, platform: 'future-os' }).platform).toBe('unknown')
  render(<>{['windows', 'linux', 'darwin', 'android', 'future-os'].map(platform => <DevicePlatformIcon key={platform} platform={platform} />)}</>)
  for (const name of ['Windows', 'Linux', 'macOS', 'Android', '未知系统']) {
    expect(screen.getByRole('img', { name })).toBeVisible()
  }
})
