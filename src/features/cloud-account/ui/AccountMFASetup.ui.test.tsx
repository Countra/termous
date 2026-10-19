import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, expect, test, vi } from 'vitest'
import { changeLanguage } from '#shared/i18n'
import { AccountMFASetup } from './AccountMFASetup'

beforeAll(async () => { await changeLanguage('zh-CN') })
const setup = { server_time: new Date().toISOString(), setup_id: 'synthetic-setup', revision: '0', secret: 'ABCDEFGHIJKLMNOPQRSTUVWX234567AB', expires_at: new Date(Date.now() + 600_000).toISOString(), otpauth_uri: 'otpauth://totp/Termous:synthetic?secret=ABCDEFGHIJKLMNOPQRSTUVWX234567AB&issuer=Termous' }

test.each(['resolve', 'reject'])('更换绑定申请后忽略旧密钥复制的迟到结果：%s', async (outcome) => {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  let resolve!: () => void
  let reject!: (cause: Error) => void
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => new Promise<void>((done, fail) => { resolve = done; reject = fail }) } })
  try {
    const onCopyError = vi.fn()
    const view = render(<AccountMFASetup setup={setup} disabled={false} onCopyError={onCopyError} />)
    fireEvent.click(screen.getByText('无法扫码？手工输入密钥'))
    fireEvent.click(screen.getByRole('button', { name: '复制密钥' }))
    view.rerender(<AccountMFASetup setup={{ ...setup, setup_id: 'next-setup' }} disabled={false} onCopyError={onCopyError} />)
    await act(async () => { if (outcome === 'resolve') resolve(); else reject(new Error('synthetic-copy-failure')) })
    expect(screen.getByRole('button', { name: '复制密钥' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: '已复制' })).not.toBeInTheDocument()
    expect(onCopyError).not.toHaveBeenCalled()
  } finally {
    if (descriptor) Object.defineProperty(navigator, 'clipboard', descriptor)
    else Reflect.deleteProperty(navigator, 'clipboard')
  }
})

test('剪贴板不可用时反馈失败，仍可手工读取密钥', () => {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
  try {
    const onCopyError = vi.fn()
    render(<AccountMFASetup setup={setup} disabled={false} onCopyError={onCopyError} />)
    fireEvent.click(screen.getByText('无法扫码？手工输入密钥'))
    fireEvent.click(screen.getByRole('button', { name: '复制密钥' }))
    expect(onCopyError).toHaveBeenCalledOnce()
    expect(screen.getByText(setup.secret)).toBeVisible()
  } finally {
    if (descriptor) Object.defineProperty(navigator, 'clipboard', descriptor)
    else Reflect.deleteProperty(navigator, 'clipboard')
  }
})
