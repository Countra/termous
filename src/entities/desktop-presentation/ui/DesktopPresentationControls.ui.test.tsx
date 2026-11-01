import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { expect, test, vi } from 'vitest'
import { videoDefaultCapabilities, type PresentationState } from '@termous/remote-protocol/presentation'
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

test('忽略建议后关闭重开不再提示，其他会话与新建议仍可提示', async () => {
  const state: PresentationState = {
    capabilities: videoDefaultCapabilities, status: 'confirmed', revision: 1n, configRevision: 1n,
    stability: { revision: 1n, adviceRevision: 1n, decodeEpoch: 2n, confirmedDecodeEpoch: 2n,
      phase: 'stable', pressure: 'encoding', level: 51, networkEstimate: 1_000_000 },
  }
  const changed = vi.fn()
  const { rerender } = render(<DesktopPresentationControls sessionKey="a:1" state={state} onChange={changed} />, {
    wrapper: ({ children }) => <ConfigProvider theme={{ token: { motion: false } }}>{children}</ConfigProvider>,
  })
  fireEvent.click(screen.getByRole('button', { name: '显示与画质' }))
  fireEvent.click(screen.getByRole('button', { name: '保持当前配置' }))
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  rerender(<DesktopPresentationControls sessionKey="a:1" state={{ ...state, stability: { ...state.stability!, revision: 2n } }} onChange={changed} />)
  fireEvent.click(screen.getByRole('button', { name: '显示与画质' }))
  expect(screen.queryByRole('button', { name: '保持当前配置' })).toBeNull()
  rerender(<DesktopPresentationControls sessionKey="b:1" state={state} onChange={changed} />)
  expect(screen.getByRole('button', { name: '保持当前配置' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '保持当前配置' }))
  rerender(<DesktopPresentationControls sessionKey="b:1" state={{ ...state, stability: { ...state.stability!, revision: 3n, adviceRevision: 2n } }} onChange={changed} />)
  expect(screen.getByRole('button', { name: '保持当前配置' })).toBeInTheDocument()
  expect(changed).not.toHaveBeenCalled()
})
