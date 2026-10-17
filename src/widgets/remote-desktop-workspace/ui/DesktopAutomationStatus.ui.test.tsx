import { ConfigProvider } from 'antd'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { RemoteDesktopSession } from '#entities/remote-desktop'
import { DesktopAutomationStatus } from './DesktopAutomationStatus'

const runtime = vi.hoisted(() => ({
  automation: {
    show: vi.fn(async () => undefined),
    reclaim: vi.fn(async () => undefined),
  },
}))
vi.mock('#features/remote-desktop', () => ({ useRemoteDesktopRuntime: () => runtime }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-17T00:00:00Z'))
  runtime.automation.show.mockReset().mockResolvedValue(undefined)
  runtime.automation.reclaim.mockReset().mockResolvedValue(undefined)
})
afterEach(() => vi.useRealTimers())

function session(): RemoteDesktopSession {
  return {
    id: 'desktop', connection_generation: 3,
    automation: { id: 'control', source: 'agent', client_name: 'Termous Agent', state: 'active',
      expires_at: '2026-10-17T00:30:00Z', idle_expires_at: '2026-10-17T00:15:00Z' },
  } as RemoteDesktopSession
}

function status(value: RemoteDesktopSession) {
  return <ConfigProvider theme={{ token: { motion: false } }}><DesktopAutomationStatus session={value} /></ConfigProvider>
}

test('普通会话不显示接管提示，来源与倒计时按当前控制权更新', () => {
  const value = session()
  const view = render(status({ ...value, automation: undefined }))
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  view.rerender(status(value))
  expect(screen.getByText('remoteDesktop.automation.aiControlling')).toBeVisible()
  expect(screen.getByText('15:00')).toBeVisible()
  expect(view.container.querySelector('[aria-live]')).toBeNull()
  act(() => vi.advanceTimersByTime(1000))
  expect(screen.getByText('14:59')).toBeVisible()
  view.rerender(status({ ...value, automation: { ...value.automation!, source: 'workflow' } }))
  expect(screen.getByText('remoteDesktop.automation.workflowControlling')).toBeVisible()
})

test('授权到期不伪造释放结果，仍保留收回控制入口；无效时间不展示 NaN', () => {
  const value = session()
  const view = render(status({ ...value, automation: { ...value.automation!, idle_expires_at: '2026-10-17T00:00:01Z' } }))
  act(() => vi.advanceTimersByTime(1000))
  expect(screen.getByText('remoteDesktop.automation.expired')).toBeVisible()
  expect(screen.getByRole('button', { name: 'remoteDesktop.automation.reclaim' })).toBeEnabled()
  expect(runtime.automation.reclaim).not.toHaveBeenCalled()
  view.rerender(status({ ...value, automation: { ...value.automation!, expires_at: 'invalid' } }))
  expect(screen.getByText('—')).toBeVisible()
  expect(view.container).not.toHaveTextContent('NaN')
})

test('托管画面保留原有查看与收回控制参数', async () => {
  render(status({ ...session(), automation: undefined, automation_host_id: 'hosted-view' }))
  expect(screen.getByText('remoteDesktop.automation.observing')).toBeVisible()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'remoteDesktop.automation.view' })))
  expect(runtime.automation.show).toHaveBeenCalledWith('desktop', 3, 'hosted-view')
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'remoteDesktop.automation.reclaim' })))
  expect(runtime.automation.reclaim).toHaveBeenCalledWith('desktop', 3)
})

test('收回控制期间阻止重复提交，失败后显示反馈并允许重试', async () => {
  let reject!: (error: Error) => void
  runtime.automation.reclaim.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
  render(status(session()))
  const button = screen.getByRole('button', { name: 'remoteDesktop.automation.reclaim' })
  fireEvent.click(button)
  fireEvent.click(button)
  expect(runtime.automation.reclaim).toHaveBeenCalledTimes(1)
  expect(button).toBeDisabled()
  await act(async () => reject(new Error('failed')))
  expect(screen.getByRole('alert')).toHaveTextContent('remoteDesktop.automation.actionFailed')
  expect(button).toBeEnabled()
  await act(async () => fireEvent.click(button))
  expect(runtime.automation.reclaim).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test('连接代次变化后，旧操作的失败不能覆盖新请求状态', async () => {
  let rejectOld!: (error: Error) => void
  let finishNew!: () => void
  runtime.automation.reclaim.mockImplementationOnce(() => new Promise((_, fail) => { rejectOld = fail }))
    .mockImplementationOnce(() => new Promise(resolve => { finishNew = () => resolve(undefined) }))
  const value = session()
  const view = render(status(value))
  fireEvent.click(screen.getByRole('button', { name: 'remoteDesktop.automation.reclaim' }))
  view.rerender(status({ ...value, connection_generation: 4 }))
  const button = screen.getByRole('button', { name: 'remoteDesktop.automation.reclaim' })
  expect(button).toBeEnabled()
  fireEvent.click(button)
  expect(runtime.automation.reclaim).toHaveBeenLastCalledWith('desktop', 4)
  await act(async () => rejectOld(new Error('old failure')))
  expect(button).toBeDisabled()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  await act(async () => finishNew())
  expect(button).toBeEnabled()
})
