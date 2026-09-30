import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, expect, test, vi } from 'vitest'
import { changeLanguage } from '#shared/i18n'
import type { CloudGateway } from '#entities/cloud'
import { AccountAuth } from './AccountAuth'

beforeAll(async () => { await changeLanguage('zh-CN') })
const run = async <T,>(action: () => Promise<T>) => action()

test('认证流程分组可达，切换模式保留邮箱并清理密码与验证串', async () => {
  const api = { auth: vi.fn(), login: vi.fn() } as unknown as CloudGateway
  render(<AccountAuth api={api} generation="fixture" busy={false} run={run} />)
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'fixture@example.test' } })
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'synthetic-password' } })
  fireEvent.click(screen.getByRole('button', { name: '注册账号' }))
  expect(screen.getByRole('heading', { name: '注册账号' })).toBeInTheDocument()
  expect(screen.getByLabelText('邮箱')).toHaveValue('fixture@example.test')
  expect(screen.getByLabelText('密码')).toHaveValue('')
  fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: '验证邮箱' }))
  fireEvent.change(screen.getByLabelText('邮件验证串'), { target: { value: 'synthetic-token' } })
  fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: '重发验证邮件' }))
  expect(screen.getByLabelText('邮箱')).toHaveValue('fixture@example.test')
  fireEvent.click(screen.getByRole('button', { name: '返回登录' }))
  fireEvent.click(screen.getByRole('button', { name: '忘记密码' }))
  fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: '重置密码' }))
  expect(screen.getByLabelText('邮件验证串')).toHaveValue('')
  fireEvent.change(screen.getByLabelText('邮件验证串'), { target: { value: 'reset-token' } })
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: ' synthetic-password ' } })
  fireEvent.click(screen.getByRole('button', { name: '重置密码' }))
  await waitFor(() => expect(api.auth).toHaveBeenCalledWith('password-reset/confirm', expect.objectContaining({ generation: 'fixture', token: 'reset-token', password: ' synthetic-password ' })))
  expect(api.login).not.toHaveBeenCalled()
})

test('重新登录仅验证当前账号，不展示注册与密码重置入口', () => {
  const api = {} as CloudGateway
  render(<AccountAuth api={api} generation="fixture" email="fixture@example.test" reauthenticate busy={false} run={run} />)
  expect(screen.getByLabelText('邮箱')).toHaveAttribute('readonly')
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '返回登录' })).not.toBeInTheDocument()
})
