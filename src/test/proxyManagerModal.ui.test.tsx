import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { ConnectionProxy, ConnectionProxyInput } from '../types/domain'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('antd', () => {
  const Button = ({
    children,
    disabled,
    onClick,
  }: {
    children?: ReactNode
    disabled?: boolean
    onClick?: () => void
  }) => <button type="button" disabled={disabled} onClick={onClick}>{children}</button>
  const Input = ({
    id,
    name,
    value,
    disabled,
    placeholder,
    onChange,
    onPressEnter,
  }: {
    id?: string
    name?: string
    value?: string
    disabled?: boolean
    placeholder?: string
    onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void
    onPressEnter?: () => void
  }) => (
    <input
      id={id}
      name={name}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={onChange}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onPressEnter?.()
      }}
    />
  )
  const Select = ({
    id,
    value,
    disabled,
    options,
    onChange,
  }: {
    id?: string
    value?: string
    disabled?: boolean
    options?: Array<{ value: string; label: string }>
    onChange?: (value: string) => void
  }) => (
    <select id={id} value={value} disabled={disabled} onChange={(event) => onChange?.(event.target.value)}>
      {options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  )
  return {
    Button,
    Empty: Object.assign(({ description }: { description?: ReactNode }) => <div>{description}</div>, {
      PRESENTED_IMAGE_SIMPLE: null,
    }),
    Input,
    Modal: ({ open, title, children }: { open: boolean; title?: ReactNode; children: ReactNode }) => (
      open ? <div role="dialog">{title}{children}</div> : null
    ),
    Popconfirm: ({
      children,
      disabled,
      onConfirm,
    }: {
      children: ReactNode
      disabled?: boolean
      onConfirm?: () => void
    }) => (
      <span>
        {children}
        {!disabled ? <button type="button" onClick={onConfirm}>confirm-delete</button> : null}
      </span>
    ),
    Select,
    Tooltip: ({ children }: { children: ReactNode }) => children,
  }
})

import { ProxyManagerModal } from '../features/hosts/ui/ProxyManagerModal'

function proxy(id: string, overrides: Partial<ConnectionProxy> = {}): ConnectionProxy {
  return {
    id,
    name: 'Proxy Alpha',
    type: 'http_connect',
    url: 'http://127.0.0.1:8080',
    bound_host_count: 0,
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

describe('ProxyManagerModal 行为合同', () => {
  it('更新失败时保留草稿，成功后才使用服务端快照回填', async () => {
    const user = userEvent.setup()
    const current = proxy('proxy-a')
    const saved = proxy('proxy-a', { name: 'Proxy Server' })
    const pending = deferred<ConnectionProxy | undefined>()
    const onUpdate = vi.fn<(id: string, input: ConnectionProxyInput) => Promise<ConnectionProxy | undefined>>()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(async () => pending.promise)
    const props = {
      open: true,
      proxies: [current],
      actionBusy: false,
      onClose: vi.fn(),
      onCreate: vi.fn<(input: ConnectionProxyInput) => Promise<ConnectionProxy | undefined>>(),
      onUpdate,
      onDelete: vi.fn<(id: string) => Promise<boolean | undefined>>(),
    }
    const view = render(<ProxyManagerModal {...props} />)

    await user.click(screen.getByRole('option', { name: /Proxy Alpha/ }))
    const nameInput = document.getElementById('connection-proxy-name') as HTMLInputElement
    await user.clear(nameInput)
    await user.type(nameInput, '  Proxy Draft  ')
    await user.click(screen.getByRole('button', { name: 'app.save' }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1))
    expect(onUpdate.mock.calls[0][1].name).toBe('Proxy Draft')
    expect(nameInput).toHaveValue('  Proxy Draft  ')

    await user.click(screen.getByRole('button', { name: 'app.save' }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(2))
    view.rerender(<ProxyManagerModal {...props} proxies={[saved]} />)
    pending.resolve(saved)
    await waitFor(() => expect(document.getElementById('connection-proxy-name')).toHaveValue(saved.name))
  })

  it('存在绑定主机时不提供代理删除确认入口', async () => {
    const user = userEvent.setup()
    const bound = proxy('proxy-bound', { bound_host_count: 2 })
    render(
      <ProxyManagerModal
        open
        proxies={[bound]}
        actionBusy={false}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('option', { name: /Proxy Alpha/ }))
    expect(screen.queryByRole('button', { name: 'confirm-delete' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'app.delete' })).toBeDisabled()
  })
})
