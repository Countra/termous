import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { RemoteResult, RemoteWindowBridge } from '#common/contracts'
import { RemoteWindowControls } from './RemoteWindowControls'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

function fixture(isMaximized = vi.fn<() => Promise<RemoteResult<boolean>>>(async () => ({ ok: true, value: false }))) {
  let update!: (value: boolean) => void
  const stop = vi.fn()
  const controls = {
    isMaximized, minimize: vi.fn(async () => ({ ok: true as const, value: true })),
    toggleMaximize: vi.fn(async () => { update(true); return { ok: true as const, value: true } }),
    onMaximizeState: (listener: (value: boolean) => void) => { update = listener; return stop },
  }
  const close = vi.fn(async () => {})
  const error = vi.fn()
  const view = render(<RemoteWindowControls bridge={{ windowControls: controls, close } as unknown as RemoteWindowBridge} onError={error} />)
  return { ...controls, close, error, stop, view, update: (value: boolean) => act(() => update(value)) }
}

test('窗口按钮独立于远端连接，系统还原事件同步图标且卸载清理订阅', async () => {
  const f = fixture()
  await waitFor(() => expect(f.isMaximized).toHaveBeenCalledOnce())
  fireEvent.click(screen.getByRole('button', { name: 'app.maximize' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'app.restore' })).toBeEnabled())
  f.update(false)
  expect(screen.getByRole('button', { name: 'app.maximize' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'app.minimize' }))
  await waitFor(() => expect(f.minimize).toHaveBeenCalledOnce())
  await waitFor(() => expect(screen.getByRole('button', { name: 'app.close' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'app.close' }))
  await waitFor(() => expect(f.close).toHaveBeenCalledOnce())
  f.view.unmount()
  expect(f.stop).toHaveBeenCalledOnce()
})

test('迟到的初始状态不能覆盖系统事件，失败操作可重试且不丢失错误', async () => {
  let finish!: (value: RemoteResult<boolean>) => void
  const read = vi.fn(() => new Promise<RemoteResult<boolean>>(resolve => { finish = resolve }))
  const f = fixture(read)
  f.update(true)
  await act(async () => finish({ ok: true, value: false }))
  expect(screen.getByRole('button', { name: 'app.restore' })).toBeEnabled()
  f.minimize.mockRejectedValueOnce(new Error('模拟窗口操作失败'))
  fireEvent.click(screen.getByRole('button', { name: 'app.minimize' }))
  await waitFor(() => expect(f.error).toHaveBeenCalledOnce())
  expect(screen.getByRole('button', { name: 'app.minimize' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'app.minimize' }))
  await waitFor(() => expect(f.minimize).toHaveBeenCalledTimes(2))
})
