import { renderWithFeedback as render } from '../../../test/renderWithFeedback'
import { StrictMode } from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeAll, expect, test, vi } from 'vitest'
import { changeLanguage } from '#shared/i18n'
import type { CloudGateway } from '#entities/cloud'
import type { CloudQRLogin, CloudStatus } from '#common/contracts'
import { AccountQRLogin } from './AccountQRLogin'

beforeAll(async () => { await changeLanguage('zh-CN') })
function fixture(state = 'pending') {
  const item: CloudQRLogin = { id: 'qr-test', state: state as CloudQRLogin['state'], revision: '1', pairing_code: '123456', qr_code: 'termous://qr-login?v=1', expires_at: new Date(Date.now() + 180000).toISOString(), remaining_seconds: 180 }
  const status = { generation: 'fixture', qr_login: item } as CloudStatus
  const api = { subscribeStatus: () => () => {}, getStatus: () => status, qrLogin: vi.fn(async () => item) } as unknown as CloudGateway
  return { api, status, item }
}

test('扫码由 Go 协调，StrictMode 单次创建且离开后取消待确认请求', async () => {
  const { api } = fixture()
  const page = render(<StrictMode><AccountQRLogin api={api} generation="fixture" reauthenticate={false} /></StrictMode>)
  await waitFor(() => expect(api.qrLogin).toHaveBeenCalledTimes(1))
  expect(api.qrLogin).toHaveBeenCalledWith({ generation: 'fixture', action: 'create', reauthenticate: false })
  expect(screen.getByRole('status')).toHaveTextContent('等待扫描')
  page.unmount()
  await act(async () => { await Promise.resolve() })
  expect(api.qrLogin).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'cancel', id: 'qr-test' }))
})

test('重新验证绑定原账号，已批准时离开只退订，不取消登录', async () => {
  const { api } = fixture('approved')
  const page = render(<AccountQRLogin api={api} generation="fixture" reauthenticate />)
  await waitFor(() => expect(api.qrLogin).toHaveBeenCalledWith(expect.objectContaining({ action: 'create', reauthenticate: true })))
  expect(screen.getByText('123456')).toBeInTheDocument()
  page.unmount()
  await act(async () => { await Promise.resolve() })
  expect(api.qrLogin).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'watch', watching: false }))
})

test('过期由用户刷新，界面不生成自动续码循环', async () => {
  const { api } = fixture('expired')
  render(<AccountQRLogin api={api} generation="fixture" reauthenticate={false} />)
  await waitFor(() => expect(api.qrLogin).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('button', { name: '刷新二维码' }))
  await waitFor(() => expect(api.qrLogin).toHaveBeenCalledTimes(2))
  expect(api.qrLogin).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'create' }))
})

test('创建尚未返回就离开，迟到结果仍取消且不重新附着', async () => {
  const { api, status, item } = fixture()
  status.qr_login = undefined
  let resolve!: (value: CloudQRLogin) => void
  vi.mocked(api.qrLogin).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const page = render(<AccountQRLogin api={api} generation="fixture" reauthenticate={false} />)
  await waitFor(() => expect(api.qrLogin).toHaveBeenCalledTimes(1))
  page.unmount()
  await act(async () => { await Promise.resolve() })
  expect(api.qrLogin).toHaveBeenCalledTimes(1)
  await act(async () => { status.qr_login = item; resolve(item) })
  expect(api.qrLogin).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'cancel', id: item.id }))
})

test('创建期间隐藏窗口，响应返回后立即暂停主动读取', async () => {
  const { api, item } = fixture()
  let resolve!: (value: CloudQRLogin) => void
  vi.mocked(api.qrLogin).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const page = render(<AccountQRLogin api={api} generation="fixture" reauthenticate={false} />)
  await waitFor(() => expect(api.qrLogin).toHaveBeenCalledTimes(1))
  const original = Object.getOwnPropertyDescriptor(document, 'hidden')
  try {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    await act(async () => resolve(item))
    expect(api.qrLogin).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'watch', watching: false }))
  } finally {
    if (original) Object.defineProperty(document, 'hidden', original)
    else Reflect.deleteProperty(document, 'hidden')
    page.unmount()
  }
})

test('刷新期间离开且响应丢失，清理 Core 中已创建的新流程', async () => {
  const { api, status, item } = fixture('expired')
  const page = render(<AccountQRLogin api={api} generation="fixture" reauthenticate={false} />)
  await waitFor(() => expect(api.qrLogin).toHaveBeenCalledTimes(1))
  let reject!: (error: Error) => void
  vi.mocked(api.qrLogin).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
  fireEvent.click(screen.getByRole('button', { name: '刷新二维码' }))
  await waitFor(() => expect(api.qrLogin).toHaveBeenCalledTimes(2))
  page.unmount()
  await act(async () => { await Promise.resolve() })
  await act(async () => {
    status.qr_login = { ...item, id: 'replacement', state: 'pending' }
    reject(new Error('response lost'))
  })
  expect(api.qrLogin).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'cancel', id: 'replacement' }))
})

test.each([
  ['approved', '正在完成登录', false],
  ['issued', '正在完成登录', false],
  ['completed', '登录完成', false],
  ['rejected', '手机已拒绝登录', true],
] as const)('扫码 %s 状态不被旧二维码倒计时误报为过期', async (state, label, refresh) => {
  const { api, item } = fixture(state)
  item.remaining_seconds = 0
  render(<AccountQRLogin api={api} generation="fixture" reauthenticate={false} />)
  await waitFor(() => expect(api.qrLogin).toHaveBeenCalledOnce())
  expect(screen.getByRole('status')).toHaveTextContent(label)
  expect(screen.queryByText('二维码已过期')).not.toBeInTheDocument()
  expect(Boolean(screen.queryByRole('button', { name: '刷新二维码' }))).toBe(refresh)
  expect(screen.queryByText('0 秒后失效')).not.toBeInTheDocument()
})
