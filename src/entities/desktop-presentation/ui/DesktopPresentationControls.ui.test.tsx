import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { videoDefaultCapabilities } from '@termous/remote-protocol/presentation'
import { DesktopPresentationControls } from './DesktopPresentationControls.tsx'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }))

test('中继限制与用户上限分别展示，不把安全降速显示为设置失败', () => {
  const changed = vi.fn()
  render(<DesktopPresentationControls state={{
    capabilities: videoDefaultCapabilities,
    requested: { kind: 'video', size: 'auto', bitrate: 100_000_000, framerate: 60 },
    applied: { width: 1920, height: 1080, bitrate: 24_000_000, framerate: 60 },
    transport: { revision: 2n, path: 'relay', bitrateLimit: 24_000_000 },
    status: 'confirmed', revision: 1n, configRevision: 3n,
  }} onChange={changed} />)
  fireEvent.click(screen.getByRole('button', { name: '显示与画质' }))
  fireEvent.click(screen.getByText('连接信息', { selector: 'summary span' }))
  expect(screen.getByText('用户码率上限').nextElementSibling).toHaveTextContent('100 Mbps')
  expect(screen.getByText('协商码率上限').nextElementSibling).toHaveTextContent('100 Mbps')
  expect(screen.getByText('媒体路径').nextElementSibling).toHaveTextContent('中继')
  expect(screen.getByText('路径码率上限').nextElementSibling).toHaveTextContent('24 Mbps')
  expect(screen.getByText('当前编码预算').nextElementSibling).toHaveTextContent('60 fps · 24.00 Mbps')
  expect(screen.getByRole('status')).toHaveTextContent('设置已生效')
  expect(changed).not.toHaveBeenCalled()
})
