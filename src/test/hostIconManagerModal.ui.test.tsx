import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { HostIcon, HostIconReorderItem } from '#entities/host'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => (
      options?.count === undefined ? key : `${key}:${options.count}`
    ),
  }),
}))

vi.mock('antd', () => {
  const Button = ({
    children,
    icon,
    disabled,
    loading,
    onClick,
    onKeyDown,
    ...props
  }: {
    children?: ReactNode
    icon?: ReactNode
    disabled?: boolean
    loading?: boolean
    onClick?: () => void
    onKeyDown?: React.KeyboardEventHandler<HTMLButtonElement>
    [key: string]: unknown
  }) => (
    <button
      type="button"
      disabled={disabled}
      data-loading={loading ? 'true' : undefined}
      aria-label={typeof props['aria-label'] === 'string' ? props['aria-label'] : undefined}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {icon}
      {children}
    </button>
  )
  const Input = ({
    id,
    name,
    value,
    disabled,
    onChange,
    onPressEnter,
    ...props
  }: {
    id?: string
    name?: string
    value?: string
    disabled?: boolean
    onChange?: React.ChangeEventHandler<HTMLInputElement>
    onPressEnter?: () => void
    [key: string]: unknown
  }) => (
    <input
      id={id}
      name={name}
      value={value}
      disabled={disabled}
      aria-label={typeof props['aria-label'] === 'string' ? props['aria-label'] : undefined}
      onChange={onChange}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onPressEnter?.()
      }}
    />
  )
  return {
    Alert: ({ message, onClose }: { message: ReactNode; onClose?: () => void }) => (
      <div role="alert">
        {message}
        <button type="button" onClick={onClose}>close-alert</button>
      </div>
    ),
    Button,
    Empty: Object.assign(({ description }: { description?: ReactNode }) => <div>{description}</div>, {
      PRESENTED_IMAGE_SIMPLE: null,
    }),
    Image: ({ src, alt, loading }: { src?: string; alt?: string; loading?: 'eager' | 'lazy' }) => (
      <img src={src} alt={alt} loading={loading} />
    ),
    Input,
    Modal: ({ open, title, children }: { open: boolean; title?: ReactNode; children: ReactNode }) => (
      open ? <div role="dialog">{title}{children}</div> : null
    ),
    Popconfirm: ({
      children,
      disabled,
      title,
      onConfirm,
    }: {
      children: ReactNode
      disabled?: boolean
      title?: ReactNode
      onConfirm?: () => void
    }) => (
      <span>
        {children}
        {!disabled ? <button type="button" onClick={onConfirm}>confirm-{title}</button> : null}
      </span>
    ),
    Tooltip: ({ children }: { children: ReactNode }) => children,
  }
})

import { HostIconManagerModal } from '../features/hosts/ui/HostIconManagerModal'

function hostIcon(id: string, sortOrder: number, displayName = `Icon ${id}`): HostIcon {
  return {
    id,
    display_name: displayName,
    file_name: `${id}.png`,
    mime_type: 'image/png',
    size_bytes: 1024,
    sha256: `sha-${id}`,
    sort_order: sortOrder,
    created_at: `2026-08-11T00:00:0${sortOrder}Z`,
  }
}

function props(overrides: Partial<React.ComponentProps<typeof HostIconManagerModal>> = {}) {
  return {
    open: true,
    hostIcons: [hostIcon('a', 0), hostIcon('b', 1)],
    hosts: [],
    protectedIconIds: [],
    actionBusy: false,
    getIconUrl: (id: string) => `http://localhost/${id}`,
    onClose: vi.fn(),
    onUpload: vi.fn<(file: File) => Promise<HostIcon>>(),
    onRename: vi.fn<(id: string, name: string) => Promise<HostIcon>>(),
    onReorder: vi.fn<(items: HostIconReorderItem[]) => Promise<HostIcon[]>>(),
    onDelete: vi.fn<(id: string) => Promise<void>>(),
    ...overrides,
  }
}

function rowIds() {
  return screen.getAllByRole('listitem').map((row) => row.getAttribute('data-icon-id'))
}

describe('HostIconManagerModal 行为合同', () => {
  it('复用上传校验并按 ID 合并重复内容返回的既有图标', async () => {
    const existing = hostIcon('a', 0)
    const onUpload = vi.fn(async () => existing)
    render(<HostIconManagerModal {...props({ hostIcons: [existing], onUpload })} />)
    const input = screen.getByLabelText('hosts.iconLibrary.add', { selector: 'input' })
    expect(input).toHaveAttribute('multiple')

    fireEvent.change(input, {
      target: { files: [new File(['bad'], 'invalid.txt', { type: 'text/plain' })] },
    })
    expect(onUpload).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('hosts.icon.invalidType')

    fireEvent.change(input, {
      target: { files: [new File(['icon'], 'server.png', { type: 'image/png' })] },
    })
    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1))
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })

  it('按选择顺序串行批量上传，并按 ID 合并服务端去重结果', async () => {
    const existing = hostIcon('a', 0)
    const uploaded = hostIcon('c', 1)
    const another = hostIcon('d', 2)
    let resolveFirst: ((icon: HostIcon) => void) | undefined
    const onUpload = vi.fn((file: File) => {
      if (file.name === 'first.png') {
        return new Promise<HostIcon>((resolve) => {
          resolveFirst = resolve
        })
      }
      if (file.name === 'duplicate.png') return Promise.resolve(existing)
      return Promise.resolve(another)
    })
    render(<HostIconManagerModal {...props({ hostIcons: [existing], onUpload })} />)
    const input = screen.getByLabelText('hosts.iconLibrary.add', { selector: 'input' })

    fireEvent.change(input, {
      target: {
        files: [
          new File(['first'], 'first.png', { type: 'image/png' }),
          new File(['duplicate'], 'duplicate.png', { type: 'image/png' }),
          new File(['another'], 'another.png', { type: 'image/png' }),
        ],
      },
    })

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1))
    expect(onUpload.mock.calls[0]?.[0].name).toBe('first.png')
    expect(screen.getByRole('button', { name: 'hosts.iconLibrary.add' })).toHaveAttribute(
      'data-loading',
      'true',
    )
    screen.getAllByRole('button', { name: 'app.edit' }).forEach((button) => {
      expect(button).toBeDisabled()
    })

    await act(async () => {
      resolveFirst?.(uploaded)
    })
    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(3))
    expect(onUpload.mock.calls.map(([file]) => file.name)).toEqual([
      'first.png',
      'duplicate.png',
      'another.png',
    ])
    await waitFor(() => expect(rowIds()).toEqual(['a', 'c', 'd']))
  })

  it('批量导入跳过非法文件，且单个上传失败不阻断后续文件', async () => {
    const onUpload = vi.fn(async (file: File) => {
      if (file.name === 'broken.png') throw new Error('failed')
      return hostIcon('good', 2)
    })
    render(<HostIconManagerModal {...props({ onUpload })} />)
    const input = screen.getByLabelText('hosts.iconLibrary.add', { selector: 'input' })

    fireEvent.change(input, {
      target: {
        files: [
          new File(['bad'], 'invalid.txt', { type: 'text/plain' }),
          new File(['broken'], 'broken.png', { type: 'image/png' }),
          new File(['good'], 'good.png', { type: 'image/png' }),
        ],
      },
    })

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(2))
    expect(onUpload.mock.calls.map(([file]) => file.name)).toEqual(['broken.png', 'good.png'])
    await waitFor(() => expect(document.querySelector('[data-icon-id="good"]')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent(
      'hosts.iconLibrary.batchUploadPartialFailed:2',
    )
  })

  it('批量上传全部失败时完成整个批次并汇总失败数量', async () => {
    const onUpload = vi.fn(async () => {
      throw new Error('failed')
    })
    render(<HostIconManagerModal {...props({ onUpload })} />)
    const input = screen.getByLabelText('hosts.iconLibrary.add', { selector: 'input' })

    fireEvent.change(input, {
      target: {
        files: [
          new File(['first'], 'first.png', { type: 'image/png' }),
          new File(['second'], 'second.png', { type: 'image/png' }),
        ],
      },
    })

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('alert')).toHaveTextContent('hosts.iconLibrary.batchUploadFailed:2')
    expect(screen.getByRole('button', { name: 'hosts.iconLibrary.add' })).not.toHaveAttribute(
      'data-loading',
    )
  })

  it('改名失败时保留输入和编辑状态，成功后使用返回记录更新列表', async () => {
    const user = userEvent.setup()
    const current = hostIcon('a', 0)
    const renamed = { ...current, display_name: 'Production' }
    const onRename = vi.fn<(id: string, name: string) => Promise<HostIcon>>()
      .mockRejectedValueOnce(new Error('failed'))
      .mockResolvedValueOnce(renamed)
    render(<HostIconManagerModal {...props({ hostIcons: [current], onRename })} />)

    await user.click(screen.getByRole('button', { name: 'app.edit' }))
    const input = screen.getByRole('textbox', { name: 'hosts.iconLibrary.name' })
    await user.clear(input)
    await user.type(input, '  Production  ')
    await user.click(screen.getByRole('button', { name: 'app.save' }))

    await waitFor(() => expect(onRename).toHaveBeenCalledWith('a', 'Production'))
    expect(screen.getByRole('textbox', { name: 'hosts.iconLibrary.name' })).toHaveValue('  Production  ')
    expect(screen.getByRole('alert')).toHaveTextContent('hosts.iconLibrary.renameFailed')

    await user.click(screen.getByRole('button', { name: 'app.save' }))
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'hosts.iconLibrary.name' })).not.toBeInTheDocument())
    expect(screen.getByText('Production')).toBeInTheDocument()
  })

  it('移动时提交完整连续排序，并在服务端失败后恢复原顺序', async () => {
    const user = userEvent.setup()
    const onReorder = vi.fn(async () => {
      throw new Error('failed')
    })
    render(<HostIconManagerModal {...props({ onReorder })} />)

    expect(rowIds()).toEqual(['a', 'b'])
    await user.click(screen.getAllByRole('button', { name: 'app.moveDown' })[0])
    await waitFor(() => expect(onReorder).toHaveBeenCalledWith([
      { id: 'b', sort_order: 0 },
      { id: 'a', sort_order: 1 },
    ]))
    await waitFor(() => expect(rowIds()).toEqual(['a', 'b']))
    expect(screen.getByRole('alert')).toHaveTextContent('hosts.iconLibrary.reorderFailed')
  })

  it('预览延迟加载，排序成功后采用服务端返回的最终顺序', async () => {
    const user = userEvent.setup()
    const onReorder = vi.fn(async () => [hostIcon('a', 0), hostIcon('b', 1)])
    render(<HostIconManagerModal {...props({ onReorder })} />)

    screen.getAllByRole('img').forEach((image) => {
      expect(image).toHaveAttribute('loading', 'lazy')
    })

    await user.click(screen.getAllByRole('button', { name: 'app.moveDown' })[0])
    await waitFor(() => expect(onReorder).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(rowIds()).toEqual(['a', 'b']))
  })

  it('同时保护持久化引用和未保存草稿，仅允许删除未使用图标', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn(async () => undefined)
    render(
      <HostIconManagerModal
        {...props({
          hostIcons: [hostIcon('used', 0), hostIcon('draft', 1), hostIcon('free', 2)],
          hosts: [{ icon_id: 'used' }],
          protectedIconIds: ['draft'],
          onDelete,
        })}
      />,
    )

    const usedRow = document.querySelector('[data-icon-id="used"]') as HTMLElement
    const draftRow = document.querySelector('[data-icon-id="draft"]') as HTMLElement
    const freeRow = document.querySelector('[data-icon-id="free"]') as HTMLElement
    expect(within(usedRow).getByRole('button', { name: 'hosts.iconLibrary.inUse:1' })).toBeDisabled()
    expect(within(draftRow).getByRole('button', { name: 'hosts.iconLibrary.draftInUse' })).toBeDisabled()
    expect(within(freeRow).getByRole('button', { name: 'app.delete' })).toBeEnabled()

    await user.click(within(freeRow).getByRole('button', { name: 'confirm-hosts.iconLibrary.deleteTitle' }))
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('free'))
    expect(document.querySelector('[data-icon-id="free"]')).not.toBeInTheDocument()
  })
})
