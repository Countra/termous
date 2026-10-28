import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { DesktopQualityFields } from './DesktopQualityFields.tsx'
import { DesktopQualityDefaultsEditor } from './DesktopQualityDefaultsEditor.tsx'
import { presentationDefaults, videoDefaultCapabilities } from '@termous/remote-protocol/presentation'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }))
test('像素能力只展示更新上限，不提供视频码率', () => {
  const changed = vi.fn()
  render(<DesktopQualityFields settings={{ kind: 'pixels', updateRateLimit: 30 }} capabilities={{ kind: 'pixels', available: true }} onChange={changed} />)
  expect(screen.queryByRole('spinbutton', { name: '码率上限' })).toBeNull()
  fireEvent.change(screen.getByRole('spinbutton', { name: '更新频率上限' }), { target: { value: '15' } })
  expect(changed).toHaveBeenLastCalledWith({ kind: 'pixels', updateRateLimit: 15 })
})
test('默认值高级参数更新保留独立连接偏好', () => {
  const value = presentationDefaults(), changed = vi.fn()
  value.connection.wallpaper = 'disabled'
  render(<DesktopQualityDefaultsEditor value={value} disabled={false} onChange={changed} />)
  expect(screen.getByRole('combobox', { name: '分辨率上限' })).toBeVisible()
  expect(screen.queryByText('远控 RDP')).toBeNull()
  fireEvent.click(screen.getByText('RDP 直接观看', { selector: 'summary span' }))
  fireEvent.change(screen.getByRole('spinbutton', { name: '更新频率上限' }), { target: { value: '20' } })
  expect(changed).not.toHaveBeenCalled()
  fireEvent.blur(screen.getByRole('spinbutton', { name: '更新频率上限' }))
  expect(changed.mock.lastCall?.[0].connection.wallpaper).toBe('disabled')
  expect(value.pixels.updateRateLimit).toBe(30)
  expect(screen.queryByText('RDP 桌面效果')).toBeNull()
})

test.each([
  ['video', '远程控制画面', '画质方案', '省资源', 'economy'],
  ['pixels', 'RDP 直接观看', '流畅度', '均衡', 'balanced'],
  ['rfb', 'VNC 画面', '画质方案', '清晰优先', 'clear'],
] as const)('%s 预设只修改本类参数，保留其他历史值和连接效果', async (kind, title, label, option, preset) => {
  const user = userEvent.setup(), changed = vi.fn(), value = presentationDefaults()
  value.video = { kind: 'video', size: '1440p', bitrate: 12_000_000, framerate: 60 }
  value.pixels.updateRateLimit = 25
  value.connection.wallpaper = 'disabled'
  value.rfb.compression = 7
  render(<DesktopQualityDefaultsEditor value={value} disabled={false} onChange={changed} />)
  if (kind !== 'video') await user.click(screen.getByText(title, { selector: 'summary span' }))
  await user.click(within(screen.getByRole('region', { name: title })).getByRole('combobox', { name: label }))
  await user.click(screen.getByText(option))
  expect(changed).toHaveBeenCalledExactlyOnceWith({ ...value, [kind]: presentationDefaults(preset)[kind] })
  expect(value.rfb.compression).toBe(7)
  expect(value.video.framerate).toBe(60)
})

test('1440p 帧率输入使用当前档位的组合限制', () => {
  const caps = { ...videoDefaultCapabilities, videoModes: [{ maxWidth: 1440, maxHeight: 2560, maxFramerate: 40, maxBitrate: 24_000_000 }] }
  render(<DesktopQualityFields settings={{ kind: 'video', size: '1440p', bitrate: 8_000_000, framerate: 30 }} capabilities={caps} onChange={vi.fn()} />)
  expect(screen.getByRole('spinbutton', { name: '帧率上限' })).toHaveAttribute('aria-valuemax', '40')
  expect(screen.getByRole('spinbutton', { name: '码率上限' })).toHaveAttribute('aria-valuemax', '24')
})

test('自动保留 60fps 请求上限，实际最高分辨率档位可以只支持 30fps', () => {
  const caps = { ...videoDefaultCapabilities, sourceWidth: 2560, sourceHeight: 1440, videoModes: [
    { maxWidth: 1920, maxHeight: 1080, maxFramerate: 60, maxBitrate: 24_000_000 },
    { maxWidth: 2560, maxHeight: 1440, maxFramerate: 30, maxBitrate: 24_000_000 },
  ] }
  const changed = vi.fn()
  render(<DesktopQualityFields settings={{ kind: 'video', size: 'auto', bitrate: 8_000_000, framerate: 30 }} capabilities={caps} onChange={changed} />)
  expect(screen.getByRole('spinbutton', { name: '帧率上限' })).toHaveAttribute('aria-valuemax', '60')
  fireEvent.change(screen.getByRole('spinbutton', { name: '帧率上限' }), { target: { value: '60' } })
  expect(changed).toHaveBeenLastCalledWith({ kind: 'video', size: 'auto', bitrate: 8_000_000, framerate: 60 })
  expect(screen.getByText('自动平衡清晰度与流畅度，最高 1440p。')).toBeVisible()
})
