import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  AssociationSelect,
  type AssociationSelectItem,
  type AssociationSelectProps,
} from './AssociationSelect.tsx'

interface TestItem extends AssociationSelectItem {
  hostId: string
  kind: 'host' | 'profile'
  detail?: string
}

const items: TestItem[] = [
  {
    value: 'ssh-current',
    label: '当前 SSH',
    searchText: '当前 ssh host-a root production',
    hostId: 'host-a',
    kind: 'profile',
    detail: '当前 SSH 详情',
  },
  {
    value: 'ssh-backup',
    label: '备用 SSH',
    searchText: '备用 ssh host-a deploy backup',
    hostId: 'host-a',
    kind: 'profile',
    detail: '备用 SSH 详情',
  },
  {
    value: 'host-b',
    label: '北京主机',
    searchText: '北京 host-b production',
    hostId: 'host-b',
    kind: 'host',
  },
]

describe('AssociationSelect', () => {
  it('允许按当前条目或所属主机过滤候选，且保持已选值稳定展示', async () => {
    const view = renderSelect({
      value: 'ssh-current',
      isItemVisible: (item) => item.value !== 'ssh-current',
    })

    expect(screen.getByText('已选：当前 SSH')).toBeVisible()
    openSelect()
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2))
    expect(screen.getByRole('combobox').closest('.termous-select')).toBeInTheDocument()
    expect(document.querySelector('.termous-select-popup')).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '当前 SSH' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: '备用 SSH' })).toBeInTheDocument()

    view.unmount()
    renderSelect({ isItemVisible: (item) => item.hostId !== 'host-a' })
    openSelect()
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1))
    expect(screen.getByRole('option', { name: '北京主机' })).toBeInTheDocument()
  })

  it('默认使用多词交集搜索，并允许场景覆盖搜索规则', async () => {
    const defaultView = renderSelect()
    const defaultCombobox = openSelect()
    fireEvent.change(defaultCombobox, { target: { value: 'backup host-a' } })
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1))
    expect(screen.getByRole('option', { name: '备用 SSH' })).toBeInTheDocument()

    defaultView.unmount()
    const matchesSearch = vi.fn(
      (item: TestItem, query: string) => item.kind === 'host' && query === 'beijing',
    )
    renderSelect({ matchesSearch })
    const combobox = openSelect()
    fireEvent.change(combobox, { target: { value: '  BEIJING  ' } })

    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1))
    expect(matchesSearch).toHaveBeenCalledWith(expect.objectContaining({ value: 'host-b' }), 'beijing')
    expect(screen.getByRole('option', { name: '北京主机' })).toBeInTheDocument()
  })

  it('下拉关闭后拒绝迟到的详情开启回调', async () => {
    renderSelect()
    const combobox = openSelect()
    const currentTrigger = getOptionTrigger(await screen.findByText('当前 SSH'))

    fireEvent.mouseEnter(currentTrigger)
    fireEvent.mouseDown(document.body)
    await waitFor(() => expect(combobox).toHaveAttribute('aria-expanded', 'false'))
    await new Promise((resolve) => window.setTimeout(resolve, 250))

    openSelect()
    await screen.findByRole('option', { name: '当前 SSH' })
    const reopenedTrigger = getOptionTrigger(screen.getByText('当前 SSH'))
    expect(reopenedTrigger).not.toHaveAttribute('aria-describedby')
  })

  it('外部选中值变化后拒绝旧候选的迟到详情回调', async () => {
    const commonProps: AssociationSelectProps<TestItem> = {
      label: '关联配置',
      value: 'ssh-current',
      items,
      renderOption: (item) => <span>{item.label}</span>,
      renderSelection: (item) => <span>{item ? `已选：${item.label}` : '未选择'}</span>,
      renderDetails: (item) => item.detail ? <span>{item.detail}</span> : null,
      onChange: vi.fn(),
    }
    const view = render(<AssociationSelect {...commonProps} />)
    openSelect()
    const currentTrigger = getOptionTrigger(await screen.findByText('当前 SSH'))

    fireEvent.mouseEnter(currentTrigger)
    view.rerender(<AssociationSelect {...commonProps} value="ssh-backup" />)
    await new Promise((resolve) => window.setTimeout(resolve, 250))

    expect(screen.queryByText('当前 SSH 详情')).not.toBeInTheDocument()
  })

  it('快速切换候选时只保留当前详情，并在搜索时清理详情', async () => {
    renderSelect()
    const combobox = openSelect()
    const currentTrigger = getOptionTrigger(await screen.findByText('当前 SSH'))
    const backupTrigger = getOptionTrigger(screen.getByText('备用 SSH'))

    fireEvent.mouseEnter(currentTrigger)
    await waitFor(() => expect(screen.getByText('当前 SSH 详情')).toBeInTheDocument())

    fireEvent.mouseLeave(currentTrigger)
    fireEvent.mouseEnter(backupTrigger)
    await waitFor(() => {
      expect(screen.getByText('备用 SSH 详情')).toBeInTheDocument()
      expect(currentTrigger).not.toHaveAttribute('aria-describedby')
    })

    fireEvent.change(combobox, { target: { value: 'backup' } })
    await waitFor(() => expect(backupTrigger).not.toHaveAttribute('aria-describedby'))
  })

  it('透传校验可访问属性，并在选择时返回原始条目', async () => {
    const onChange = vi.fn()
    renderSelect({
      onChange,
      status: 'error',
      'aria-invalid': true,
      'aria-describedby': 'association-error',
    })
    const combobox = openSelect()
    expect(combobox).toHaveAttribute('aria-invalid', 'true')
    expect(combobox).toHaveAttribute('aria-describedby', 'association-error')

    fireEvent.click(await screen.findByRole('option', { name: '备用 SSH' }))
    expect(onChange).toHaveBeenCalledWith(
      'ssh-backup',
      expect.objectContaining({ value: 'ssh-backup', hostId: 'host-a' }),
    )
  })
})

function renderSelect(
  props: Partial<AssociationSelectProps<TestItem>> = {},
) {
  return render(
    <AssociationSelect
      label="关联配置"
      value=""
      items={items}
      renderOption={(item) => <span>{item.label}</span>}
      renderSelection={(item) => <span>{item ? `已选：${item.label}` : '未选择'}</span>}
      renderDetails={(item) => item.detail ? <span>{item.detail}</span> : null}
      onChange={vi.fn()}
      {...props}
    />,
  )
}

function openSelect() {
  const combobox = screen.getByRole('combobox', { name: '关联配置' })
  fireEvent.mouseDown(combobox)
  return combobox
}

function getOptionTrigger(label: HTMLElement) {
  const trigger = label.closest('.ant-select-item-option-content')?.firstElementChild
  if (!(trigger instanceof HTMLElement)) throw new Error('未找到候选项详情触发区域')
  return trigger
}
