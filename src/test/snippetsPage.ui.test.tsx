import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { forwardRef, type ChangeEvent, type ComponentProps, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { CodeSnippet } from '#entities/snippet'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('antd', () => {
  interface ButtonProps {
    children?: ReactNode
    disabled?: boolean
    onClick?: () => void
    'aria-label'?: string
    'aria-pressed'?: boolean
    'aria-expanded'?: boolean
  }

  interface InputProps {
    id?: string
    value?: string
    disabled?: boolean
    placeholder?: string
    onChange?: (event: ChangeEvent<HTMLInputElement>) => void
    onPressEnter?: () => void
    'aria-label'?: string
  }

  interface TextAreaProps {
    id?: string
    value?: string
    placeholder?: string
    onChange?: (event: ChangeEvent<HTMLTextAreaElement>) => void
    onSelect?: (event: React.SyntheticEvent<HTMLTextAreaElement>) => void
  }

  const Button = ({
    children,
    disabled,
    onClick,
    'aria-label': ariaLabel,
    'aria-pressed': ariaPressed,
    'aria-expanded': ariaExpanded,
  }: ButtonProps) => (
    <button
      type="button"
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      aria-expanded={ariaExpanded}
      onClick={onClick}
    >
      {children}
    </button>
  )

  const Input = Object.assign(
    ({
      id,
      value,
      disabled,
      placeholder,
      onChange,
      onPressEnter,
      'aria-label': ariaLabel,
    }: InputProps) => (
      <input
        id={id}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={onChange}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onPressEnter?.()
        }}
      />
    ),
    {
      TextArea: forwardRef<HTMLTextAreaElement, TextAreaProps>(({
        id,
        value,
        placeholder,
        onChange,
        onSelect,
      }, ref) => (
        <textarea
          ref={ref}
          id={id}
          value={value}
          placeholder={placeholder}
          onChange={onChange}
          onSelect={onSelect}
        />
      )),
    },
  )

  const Select = ({
    id,
    value,
    mode,
    options,
    onChange,
  }: {
    id?: string
    value?: string | string[]
    mode?: string
    options?: Array<{ value: string; label: ReactNode }>
    onChange?: (value: string | string[]) => void
  }) => (
    <select
      id={id}
      multiple={mode === 'tags'}
      value={value}
      onChange={(event) => {
        if (mode === 'tags') {
          onChange?.(Array.from(event.currentTarget.selectedOptions, (option) => option.value))
          return
        }
        onChange?.(event.currentTarget.value)
      }}
    >
      {options?.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  )

  return {
    Button,
    Input,
    Modal: ({
      open,
      title,
      okText,
      cancelText,
      children,
      onOk,
      onCancel,
    }: {
      open: boolean
      title?: ReactNode
      okText?: ReactNode
      cancelText?: ReactNode
      children?: ReactNode
      onOk?: () => void
      onCancel?: () => void
    }) => open ? (
      <div role="dialog" aria-label={String(title)}>
        {children}
        <button type="button" onClick={onCancel}>{cancelText}</button>
        <button type="button" onClick={onOk}>{okText}</button>
      </div>
    ) : null,
    Popconfirm: ({
      children,
      onConfirm,
    }: {
      children: ReactNode
      onConfirm?: () => void | Promise<void>
    }) => <span onClick={() => void onConfirm?.()}>{children}</span>,
    Select,
    Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
    Tooltip: ({ children }: { children: ReactNode }) => children,
  }
})

vi.mock('../features/snippets/ui/SnippetCatalog', () => ({
  SnippetFilterBar: () => null,
  SnippetList: ({
    snippets,
    onSelect,
  }: {
    snippets: CodeSnippet[]
    onSelect?: (snippet: CodeSnippet) => void
  }) => (
    <div>
      {snippets.map((snippet) => (
        <button key={snippet.id} type="button" onClick={() => onSelect?.(snippet)}>
          select-{snippet.id}
        </button>
      ))}
    </div>
  ),
}))

vi.mock('#shared/ui', () => ({
  uiStyles: {
    'field-label': 'field-label',
  },
  ConnectionActionButton: ({
    children,
    disabled,
    onClick,
  }: {
    children?: ReactNode
    disabled?: boolean
    onClick?: () => void
  }) => <button type="button" disabled={disabled} onClick={onClick}>{children}</button>,
  CustomSelect: ({
    id,
    label,
    value,
    options,
    onChange,
  }: {
    id?: string
    label: string
    value: string
    options: Array<{ value: string; label: string }>
    onChange: (value: string) => void
  }) => (
    <label>
      <span>{label}</span>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  ),
  GroupManagerModal: () => null,
}))

import { SnippetManagementWorkspace } from '#features/snippets'

function snippet(overrides: Partial<CodeSnippet> = {}): CodeSnippet {
  return {
    id: 'snippet-a',
    group_id: '',
    name: 'Alpha',
    description: 'Original description',
    command: 'echo alpha',
    tags: [],
    shell: 'bash',
    favorite: false,
    use_count: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
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

function renderWorkspace(
  snippets: CodeSnippet[],
  overrides: Partial<ComponentProps<typeof SnippetManagementWorkspace>> = {},
) {
  const props: ComponentProps<typeof SnippetManagementWorkspace> = {
    data: { snippets, snippetGroups: [] },
    actionBusy: false,
    onSave: vi.fn(async () => undefined),
    onDelete: vi.fn(async () => undefined),
    onCreateGroup: vi.fn(async () => undefined),
    onRenameGroup: vi.fn(async () => undefined),
    onDeleteGroup: vi.fn(async () => undefined),
    onReorderGroups: vi.fn(async () => undefined),
    ...overrides,
  }
  return {
    ...render(<SnippetManagementWorkspace {...props} />),
    props,
  }
}

describe('命令片段管理工作区状态合同', () => {
  it('脏草稿切换到新建时先确认，取消保留草稿，确认后进入空白编辑', async () => {
    const user = userEvent.setup()
    renderWorkspace([snippet()])
    const nameInput = document.getElementById('snippet-name') as HTMLInputElement

    await user.clear(nameInput)
    await user.type(nameInput, 'Local draft')
    await user.click(screen.getByRole('button', { name: 'snippets.add' }))

    expect(screen.getByRole('dialog', { name: 'snippets.discardTitle' })).toBeVisible()
    expect(nameInput).toHaveValue('Local draft')

    await user.click(screen.getByRole('button', { name: 'app.cancel' }))
    expect(screen.queryByRole('dialog', { name: 'snippets.discardTitle' })).toBeNull()
    expect(nameInput).toHaveValue('Local draft')

    await user.click(screen.getByRole('button', { name: 'snippets.add' }))
    await user.click(screen.getByRole('button', { name: 'snippets.discard' }))

    await waitFor(() => {
      expect(document.getElementById('snippet-name')).toHaveValue('')
      expect(document.getElementById('snippet-command')).toHaveValue('')
    })
    expect(screen.queryByRole('dialog', { name: 'snippets.discardTitle' })).toBeNull()
  })

  it('现有片段保存完成后才使用服务端快照推进基线并禁用保存', async () => {
    const user = userEvent.setup()
    const saved = snippet({ name: 'Server canonical name', updated_at: '2026-01-02T00:00:00Z' })
    const saveRequest = deferred<CodeSnippet | undefined>()
    const onSave = vi.fn(() => saveRequest.promise)
    const view = renderWorkspace([snippet()], { onSave })
    const nameInput = document.getElementById('snippet-name') as HTMLInputElement
    const saveButton = screen.getByRole('button', { name: 'app.save' })

    await user.clear(nameInput)
    await user.type(nameInput, '  Local draft  ')
    expect(saveButton).toBeEnabled()

    await user.click(saveButton)
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        'snippet-a',
        expect.objectContaining({ name: 'Local draft' }),
      )
    })

    expect(nameInput).toHaveValue('  Local draft  ')
    expect(saveButton).toBeEnabled()
    expect(screen.getByText('snippets.unsaved')).toBeVisible()

    view.rerender(
      <SnippetManagementWorkspace
        {...view.props}
        data={{ ...view.props.data, snippets: [saved] }}
      />,
    )
    expect(nameInput).toHaveValue('  Local draft  ')

    await act(async () => {
      saveRequest.resolve(saved)
      await saveRequest.promise
    })

    await waitFor(() => {
      expect(document.getElementById('snippet-name')).toHaveValue('Server canonical name')
      expect(saveButton).toBeDisabled()
    })
    expect(screen.queryByText('snippets.unsaved')).toBeNull()
  })

  it('保存失败时保留新建草稿和未保存状态', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async () => undefined)
    renderWorkspace([snippet()], { onSave })

    await user.click(screen.getByRole('button', { name: 'snippets.add' }))
    const nameInput = document.getElementById('snippet-name') as HTMLInputElement
    const commandInput = document.getElementById('snippet-command') as HTMLTextAreaElement
    await user.type(nameInput, 'Pending snippet')
    await user.type(commandInput, 'echo pending')
    await user.click(screen.getByRole('button', { name: 'app.save' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(nameInput).toHaveValue('Pending snippet')
    expect(commandInput).toHaveValue('echo pending')
    expect(screen.getByText('snippets.unsaved')).toBeVisible()
    expect(screen.getByRole('button', { name: 'app.save' })).toBeEnabled()
  })

  it('外部快照刷新不会覆盖脏草稿，清洁状态才同步服务端内容', async () => {
    const user = userEvent.setup()
    const view = renderWorkspace([snippet()])
    const nameInput = document.getElementById('snippet-name') as HTMLInputElement

    view.rerender(
      <SnippetManagementWorkspace
        {...view.props}
        data={{ ...view.props.data, snippets: [snippet({ name: 'Server refresh' })] }}
      />,
    )
    await waitFor(() => expect(nameInput).toHaveValue('Server refresh'))

    await user.clear(nameInput)
    await user.type(nameInput, 'Local pending draft')
    view.rerender(
      <SnippetManagementWorkspace
        {...view.props}
        data={{ ...view.props.data, snippets: [snippet({ name: 'Newer server refresh' })] }}
      />,
    )

    expect(nameInput).toHaveValue('Local pending draft')
    expect(screen.getByText('snippets.unsaved')).toBeVisible()
  })

  it('删除失败时保留当前片段，成功后才选择相邻片段', async () => {
    const user = userEvent.setup()
    const alpha = snippet()
    const beta = snippet({ id: 'snippet-b', name: 'Beta', command: 'echo beta' })
    const onDelete = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(true)
    renderWorkspace([alpha, beta], { onDelete })
    const deleteButton = screen.getByRole('button', { name: 'app.delete' })

    await user.click(deleteButton)
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1))
    expect(document.getElementById('snippet-name')).toHaveValue('Alpha')

    await user.click(deleteButton)
    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledTimes(2)
      expect(document.getElementById('snippet-name')).toHaveValue('Beta')
    })
  })
})
