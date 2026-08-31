import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostGroup } from '#entities/host'
import type { HostAsset } from '#entities/host-asset'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'
import { customSelectStyles } from '#shared/ui'

const i18nMock = vi.hoisted(() => ({ resolvedLanguage: 'zh-CN' as string }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: i18nMock,
    t: (key: string, values?: Record<string, string>) => {
      if (key === 'hosts.access.ssh.jumpOptionAria') {
        return `${values?.host ?? ''} ${values?.profile ?? ''} ${values?.endpoint ?? ''} ${values?.auth ?? ''}`
      }
      if (key === 'hosts.access.ssh.jumpOptionUnavailableAria') {
        return `${values?.details ?? ''} | ${values?.reason ?? ''}`
      }
      if (key === 'hosts.auth.private_key') return '私钥'
      if (key === 'hosts.auth.password') return '密码'
      return key
    },
  }),
}))

import { SSHJumpProfileSelect } from './SSHJumpProfileSelect.tsx'

const groups: HostGroup[] = [
  { id: 'group-production', name: '生产环境', sort_order: 0 },
]

const hosts: HostAsset[] = [
  {
    id: 'host-a',
    name: '阿里云香港',
    platform: 'linux',
    group_id: 'group-production',
    tags: [],
    favorite: false,
    created_at: '2026-08-27T00:00:00Z',
    updated_at: '2026-08-27T00:00:00Z',
  },
]

describe('SSHJumpProfileSelect', () => {
  beforeEach(() => {
    i18nMock.resolvedLanguage = 'zh-CN'
  })

  it('收起态明确展示主机与配置归属，展开后保持无分组扁平列表', async () => {
    renderSelector({ value: 'ssh-primary' })

    const combobox = screen.getByRole('combobox', { name: 'hosts.jumpHost' })
    expect(combobox).toBeVisible()
    expect(combobox.closest(`.${customSelectStyles['custom-select']}`)).toBeInTheDocument()
    expect(screen.getByText('阿里云香港')).toBeVisible()
    expect(screen.getByText('公网 SSH')).toBeVisible()

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'hosts.jumpHost' }))

    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3))
    expect(document.querySelector('.ant-select-item-group')).not.toBeInTheDocument()
    expect(screen.getByText('备用 SSH')).toBeInTheDocument()
    const option = screen.getByText('备用 SSH').closest('.ant-select-item-option')
    expect(option).not.toHaveAttribute('item')
    expect(option).not.toHaveAttribute('kind')
  })

  it('hover 候选时在独立浮层展示端点、分组和认证信息', async () => {
    renderSelector({ value: '' })
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'hosts.jumpHost' }))

    const profileLabel = await screen.findByText('公网 SSH')
    const optionContent = profileLabel.closest('.ant-select-item-option-content')
    const tooltipTrigger = optionContent?.firstElementChild
    expect(tooltipTrigger).toBeTruthy()
    fireEvent.mouseEnter(tooltipTrigger!)

    await waitFor(() => {
      expect(screen.getByText('root@primary.example.com:22')).toBeInTheDocument()
      expect(screen.getByText('生产环境')).toBeInTheDocument()
      expect(screen.getByText('私钥')).toBeInTheDocument()
    })
  })

  it('快速切换候选时只保留当前行的详情浮层', async () => {
    renderSelector({ value: '' })
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'hosts.jumpHost' }))

    const primaryTrigger = (await screen.findByText('公网 SSH'))
      .closest('.ant-select-item-option-content')?.firstElementChild
    const secondaryTrigger = screen.getByText('备用 SSH')
      .closest('.ant-select-item-option-content')?.firstElementChild
    expect(primaryTrigger).toBeTruthy()
    expect(secondaryTrigger).toBeTruthy()

    fireEvent.mouseEnter(primaryTrigger!)
    await waitFor(() => {
      expect(primaryTrigger).toHaveAttribute('aria-describedby')
      expect(screen.getByText('root@primary.example.com:22')).toBeInTheDocument()
    })

    fireEvent.mouseLeave(primaryTrigger!)
    fireEvent.mouseEnter(secondaryTrigger!)
    await waitFor(() => {
      expect(secondaryTrigger).toHaveAttribute('aria-describedby')
      expect(primaryTrigger).not.toHaveAttribute('aria-describedby')
      expect(screen.getByText('root@ssh-secondary.example.com:22')).toBeInTheDocument()
    })
  })

  it('不可用的多级跳板保留详情但不能选择', async () => {
    const onChange = vi.fn()
    const nested = profile('ssh-nested', '级联 SSH', false, 2)
    nested.jump_ssh_profile_id = 'ssh-upstream'
    renderSelector({ value: '', profiles: [nested], onChange })
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'hosts.jumpHost' }))

    const nestedLabel = await screen.findByText('级联 SSH')
    const option = nestedLabel.closest('.ant-select-item-option')
    expect(option).toHaveAttribute('aria-disabled', 'true')
    expect(option?.getAttribute('aria-label')).toContain(
      'hosts.access.ssh.jumpNestedUnsupported',
    )
    fireEvent.click(option!)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('主机资产缺失时明确标识详情不可用且仍保留配置', async () => {
    renderSelector({ value: '', hostItems: [] })
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'hosts.jumpHost' }))

    const profileLabel = await screen.findByText('公网 SSH')
    const tooltipTrigger = profileLabel.closest('.ant-select-item-option-content')?.firstElementChild
    expect(tooltipTrigger).toBeTruthy()
    fireEvent.mouseEnter(tooltipTrigger!)

    await waitFor(() => {
      expect(screen.getAllByText('hosts.access.ssh.jumpHostUnavailable')).not.toHaveLength(0)
      expect(screen.getByText('hosts.access.ssh.jumpGroupUnavailable')).toBeInTheDocument()
      expect(screen.queryByText('hosts.ungrouped')).not.toBeInTheDocument()
    })
  })

  it('允许使用界面展示的本地化认证名称搜索', async () => {
    const privateKey = profile('ssh-primary', '公网 SSH', true, 0)
    const password = profile('ssh-secondary', '密码 SSH', false, 1)
    password.auth_method = 'password'
    renderSelector({ value: '', profiles: [privateKey, password] })

    const combobox = screen.getByRole('combobox', { name: 'hosts.jumpHost' })
    fireEvent.mouseDown(combobox)
    fireEvent.change(combobox, { target: { value: '私钥' } })

    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1))
    expect(screen.getByRole('option', { name: /公网 SSH/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /密码 SSH/ })).not.toBeInTheDocument()
  })

  it('编辑时排除自身配置，失效选中值仍可切换为无跳板', async () => {
    const onChange = vi.fn()
    const view = renderSelector({
      value: '',
      editingProfileId: 'ssh-primary',
      onChange,
    })
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'hosts.jumpHost' }))

    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2))
    expect(screen.queryByRole('option', { name: /公网 SSH/ })).not.toBeInTheDocument()
    view.unmount()

    renderSelector({ value: 'ssh-deleted', profiles: [], onChange })
    expect(screen.getByText('hosts.access.ssh.jumpProfileUnavailable')).toBeVisible()
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'hosts.jumpHost' }))
    fireEvent.click(await screen.findByRole('option', { name: 'hosts.noJumpHost' }))
    expect(onChange).toHaveBeenLastCalledWith('')
  })

  it('当前配置被用作跳板时禁用所有非空候选，但允许清空路由', async () => {
    const current = profile('ssh-current', '当前 SSH', true, 0)
    const consumer = profile('ssh-consumer', '下游 SSH', false, 1)
    consumer.jump_ssh_profile_id = current.id
    const available = profile('ssh-available', '其他 SSH', false, 2)
    renderSelector({
      value: '',
      profiles: [current, consumer, available],
      editingProfileId: current.id,
    })
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'hosts.jumpHost' }))

    const noJump = await screen.findByRole('option', { name: 'hosts.noJumpHost' })
    expect(noJump).not.toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('option', { name: /下游 SSH/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByRole('option', { name: /其他 SSH/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('语言切换后按当前语言重新排列候选', async () => {
    const beijingHost: HostAsset = {
      ...hosts[0],
      id: 'host-b',
      name: '北京节点',
    }
    const hongKongProfile = profile('ssh-hong-kong', '香港 SSH', true, 0)
    const beijingProfile = profile('ssh-beijing', '北京 SSH', true, 0)
    beijingProfile.host_id = beijingHost.id
    const selectorProps = {
      label: 'hosts.jumpHost',
      value: '',
      profiles: [beijingProfile, hongKongProfile],
      hosts: [beijingHost, ...hosts],
      groups,
      getHostIconUrl: () => '',
      onChange: vi.fn(),
    }
    const view = render(<SSHJumpProfileSelect {...selectorProps} />)
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'hosts.jumpHost' }))

    await waitFor(() => {
      expect(getProfileOptionOrder()).toEqual(['香港 SSH', '北京 SSH'])
    })

    i18nMock.resolvedLanguage = 'en-US'
    view.rerender(<SSHJumpProfileSelect {...selectorProps} />)

    await waitFor(() => {
      expect(getProfileOptionOrder()).toEqual(['北京 SSH', '香港 SSH'])
    })
  })
})

function getProfileOptionOrder() {
  const profileNames = ['香港 SSH', '北京 SSH']
  return screen.getAllByRole('option')
    .flatMap((option) => profileNames.filter((name) => option.textContent?.includes(name)))
}

function renderSelector({
  value,
  profiles = [
    profile('ssh-primary', '公网 SSH', true, 0),
    profile('ssh-secondary', '备用 SSH', false, 1),
  ],
  hostItems = hosts,
  editingProfileId,
  onChange = vi.fn(),
}: {
  value: string
  profiles?: SSHAccessProfile[]
  hostItems?: HostAsset[]
  editingProfileId?: string
  onChange?: (value: string) => void
}) {
  return render(
    <SSHJumpProfileSelect
      label="hosts.jumpHost"
      value={value}
      profiles={profiles}
      hosts={hostItems}
      groups={groups}
      editingProfileId={editingProfileId}
      getHostIconUrl={() => ''}
      onChange={onChange}
    />,
  )
}

function profile(
  id: string,
  name: string,
  isDefault: boolean,
  sortOrder: number,
): SSHAccessProfile {
  return {
    id,
    host_id: 'host-a',
    name,
    address: id === 'ssh-primary' ? 'primary.example.com' : `${id}.example.com`,
    port: 22,
    username: 'root',
    auth_method: 'private_key',
    credential_id: 'credential-key',
    fingerprint_policy: 'confirm_on_change',
    is_default: isDefault,
    sort_order: sortOrder,
    created_at: '2026-08-27T00:00:00Z',
    updated_at: '2026-08-27T00:00:00Z',
  }
}
