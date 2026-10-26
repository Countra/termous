import { render, screen, fireEvent } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { DesktopQualityFields } from './DesktopQualityFields.tsx'
import { DesktopQualityDefaultsEditor } from './DesktopQualityDefaultsEditor.tsx'
import { presentationDefaults } from '@termous/remote-protocol/presentation'

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
  fireEvent.change(screen.getByRole('spinbutton', { name: '更新频率上限' }), { target: { value: '20' } })
  expect(changed).not.toHaveBeenCalled()
  fireEvent.blur(screen.getByRole('spinbutton', { name: '更新频率上限' }))
  expect(changed.mock.lastCall?.[0].connection.wallpaper).toBe('disabled')
  expect(value.pixels.updateRateLimit).toBe(30)
  fireEvent.click(screen.getByText('RDP 桌面效果'))
  expect(screen.getByText(/重新连接后生效/)).toBeVisible()
})
