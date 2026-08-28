import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { HostLauncherData } from '../model/types.ts'
import type {
  HostLauncherProfileMenu,
  HostLauncherProfileMenuItem,
} from '../model/hostLauncherProfiles.ts'
import { HostLauncherProfileAction } from './HostLauncherProfileAction.tsx'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe('HostLauncherProfileAction', () => {
  it('单 Profile 保持直接连接路径且始终提供管理入口', () => {
    const onRun = vi.fn()
    const onManage = vi.fn()
    renderAction({
      menu: resolvedMenu([profile('ssh-default', true)]),
      onRun,
      onManage,
    })

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', {
      name: 'workbench.hostLauncher.profiles.manage',
    })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'app.connect' }))
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'ssh-default' }))
  })

  it('多 Profile 先切换本次目标，再由主按钮执行连接', async () => {
    const onRun = vi.fn()
    renderAction({
      menu: resolvedMenu([
        profile('ssh-default', true),
        profile('ssh-secondary', false),
      ]),
      onRun,
    })

    expect(screen.getByText('ssh-default')).toBeVisible()
    openProfileSelect()
    fireEvent.click(await screen.findByRole('option', { name: /ssh-secondary/ }))

    await waitFor(() => expectSelectedProfile('ssh-secondary'))
    expect(onRun).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'app.connect' }))
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'ssh-secondary' }))
  })

  it('SSH 候选悬停详情展示完整端点与默认状态', async () => {
    const onRun = vi.fn()
    renderAction({
      menu: resolvedMenu([
        profile('ssh-default', true),
        profile('ssh-secondary', false),
      ]),
      onRun,
    })

    openProfileSelect()
    const option = await screen.findByRole('option', { name: /ssh-default/ })
    const trigger = getOptionTrigger(option)
    fireEvent.mouseEnter(trigger)

    await waitFor(() => expect(trigger).toHaveAttribute('aria-describedby'))
    const tooltip = getDescribedTooltip(trigger)
    expect(within(tooltip).getByText('ssh-default')).toBeInTheDocument()
    expect(within(tooltip).getByText('SSH')).toBeInTheDocument()
    expect(within(tooltip).getByText('root@ssh-default.example:22')).toBeInTheDocument()
    expect(within(tooltip).getByText('hosts.access.default')).toBeInTheDocument()
    expect(within(tooltip).queryByText(
      'workbench.hostLauncher.profiles.details.direct',
    )).not.toBeInTheDocument()
    expect(onRun).not.toHaveBeenCalled()
  })

  it('SSH 候选详情展示安全的凭据、代理与指纹摘要', async () => {
    const launcherData = emptyLauncherData()
    launcherData.credentials.push({
      id: 'credential-deploy',
      name: 'Deploy key',
      type: 'private_key',
      vault_id: 'internal-vault-id',
      metadata: { secret_hint: 'must-not-render' },
      bound_host_count: 1,
    })
    launcherData.proxies.push({
      id: 'proxy-office',
      name: 'Office SOCKS',
      type: 'socks5',
      url: 'socks5://proxy-user:proxy-password@127.0.0.1:1080',
      bound_host_count: 1,
    })
    launcherData.sshAccessProfiles.push({
      id: 'ssh-default',
      host_id: 'host-a',
      name: 'ssh-default',
      address: 'ssh-default.example',
      port: 22,
      username: 'root',
      auth_method: 'private_key',
      credential_id: 'credential-deploy',
      proxy_id: 'proxy-office',
      fingerprint: 'SHA256:trusted-host',
      fingerprint_policy: 'confirm_on_change',
      is_default: true,
      sort_order: 0,
      created_at: '2026-08-26T00:00:00Z',
      updated_at: '2026-08-26T00:00:00Z',
      last_connected_at: '2026-08-26T01:00:00Z',
    })
    renderAction({
      menu: resolvedMenu([
        profile('ssh-default', true),
        profile('ssh-secondary', false),
      ]),
      data: launcherData,
    })

    openProfileSelect()
    const option = await screen.findByRole('option', { name: /ssh-default/ })
    expect(option.getAttribute('aria-label')).toContain(
      'hosts.credential: Deploy key · vault.typeName.private_key',
    )
    expect(option.getAttribute('aria-label')).toContain(
      'hosts.proxy: Office SOCKS · proxies.types.socks5',
    )
    expect(option.getAttribute('aria-label')).toContain(
      'workbench.hostLauncher.profiles.details.fingerprint: SHA256:trusted-host',
    )
    expect(option.getAttribute('aria-label')).not.toContain('proxy-user')
    expect(option.getAttribute('aria-label')).not.toContain('proxy-password')
    const trigger = getOptionTrigger(option)
    fireEvent.mouseEnter(trigger)

    await waitFor(() => expect(trigger).toHaveAttribute('aria-describedby'))
    const tooltip = getDescribedTooltip(trigger)
    expect(within(tooltip).getByText('Deploy key · vault.typeName.private_key')).toBeInTheDocument()
    expect(within(tooltip).getByText('Office SOCKS · proxies.types.socks5')).toBeInTheDocument()
    expect(within(tooltip).getByText('SHA256:trusted-host')).toBeInTheDocument()
    expect(within(tooltip).queryByText('hosts.authMethod')).not.toBeInTheDocument()
    expect(within(tooltip).queryByText('hosts.auth.private_key')).not.toBeInTheDocument()
    expect(within(tooltip).queryByText('hosts.fingerprintPolicy')).not.toBeInTheDocument()
    expect(tooltip).not.toHaveTextContent('proxy-user')
    expect(tooltip).not.toHaveTextContent('proxy-password')
    expect(tooltip).not.toHaveTextContent('internal-vault-id')
    expect(tooltip).not.toHaveTextContent('must-not-render')
  })

  it('默认项冲突时不猜测目标，显式选择后才允许连接', async () => {
    const onRun = vi.fn()
    const onManage = vi.fn()
    const menu: HostLauncherProfileMenu = {
      hostId: 'host-a',
      intent: 'terminal',
      items: [profile('ssh-a', true), profile('ssh-b', true)],
      defaultItem: null,
      defaultResolution: 'ambiguous',
    }
    renderAction({ menu, onRun, onManage })

    expect(screen.getByText('workbench.hostLauncher.profiles.status.ambiguous')).toBeVisible()
    expect(screen.getByRole('button', { name: 'app.connect' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', {
      name: 'workbench.hostLauncher.profiles.manage',
    }))
    expect(onManage).toHaveBeenCalledTimes(1)

    openProfileSelect()
    fireEvent.click(await screen.findByRole('option', { name: /ssh-b/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'app.connect' })).toBeEnabled())
    expect(onRun).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'app.connect' }))
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'ssh-b' }))
  })

  it('单个可用 Profile 缺少默认标记时要求显式选择', async () => {
    const onRun = vi.fn()
    const onlyProfile = profile('ssh-only', false)
    renderAction({
      menu: {
        hostId: 'host-a',
        intent: 'terminal',
        items: [onlyProfile],
        defaultItem: null,
        defaultResolution: 'missing',
      },
      onRun,
    })

    expect(screen.getByRole('button', { name: 'app.connect' })).toBeDisabled()
    openProfileSelect()
    fireEvent.click(await screen.findByRole('option', { name: /ssh-only/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'app.connect' })).toBeEnabled())
    expect(onRun).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'app.connect' }))
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'ssh-only' }))
  })

  it('路由失效项不可选，切换到可用项后才允许打开文件', async () => {
    const onRun = vi.fn()
    const unavailable = fileProfile('file-unavailable', true, 'route_missing')
    const ready = fileProfile('file-ready', false, 'ready')
    renderAction({
      menu: {
        hostId: 'host-a',
        intent: 'files',
        items: [unavailable, ready],
        defaultItem: unavailable,
        defaultResolution: 'unavailable',
      },
      onRun,
    })

    expect(screen.getByRole('button', { name: 'workbench.hostLauncher.openFiles' })).toBeDisabled()
    openProfileSelect()
    expect(await screen.findByRole('option', { name: /file-unavailable/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    fireEvent.click(screen.getByRole('option', { name: /file-ready/ }))
    await waitFor(() => expect(screen.getByRole('button', {
      name: 'workbench.hostLauncher.openFiles',
    })).toBeEnabled())

    fireEvent.click(screen.getByRole('button', { name: 'workbench.hostLauncher.openFiles' }))
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'file-ready' }))
  })

  it('悬停候选项展示完整连接端点与路由且不触发连接', async () => {
    const onRun = vi.fn()
    const routed = desktopProfile('desktop-routed', true, {
      profileId: 'ssh-production',
      name: 'Production SSH',
      endpoint: 'root@gateway.example:22',
    })
    renderAction({
      menu: {
        hostId: 'host-a',
        intent: 'remote_desktop',
        items: [routed, desktopProfile('desktop-direct', false, null)],
        defaultItem: routed,
        defaultResolution: 'resolved',
      },
      onRun,
    })

    openProfileSelect()
    const option = await screen.findByRole('option', { name: /desktop-routed/ })
    const trigger = getOptionTrigger(option)
    fireEvent.mouseEnter(trigger)

    await waitFor(() => expect(trigger).toHaveAttribute('aria-describedby'))
    const tooltip = getDescribedTooltip(trigger)
    expect(within(tooltip).getByText('desktop-routed')).toBeInTheDocument()
    expect(within(tooltip).getByText('VNC')).toBeInTheDocument()
    expect(within(tooltip).getByText('127.0.0.1:5900')).toBeInTheDocument()
    expect(within(tooltip).getByText('Production SSH')).toBeInTheDocument()
    expect(within(tooltip).getByText('root@gateway.example:22')).toBeInTheDocument()
    expect(onRun).not.toHaveBeenCalled()
  })

  it('失效候选仍可查看原因，但不会误报为直连或改变选择', async () => {
    const onRun = vi.fn()
    const ready = fileProfile('file-ready', true, 'ready')
    const unavailable = fileProfile('file-unavailable', false, 'route_missing')
    renderAction({
      menu: {
        hostId: 'host-a',
        intent: 'files',
        items: [ready, unavailable],
        defaultItem: ready,
        defaultResolution: 'resolved',
      },
      onRun,
    })

    openProfileSelect()
    const option = await screen.findByRole('option', { name: /file-unavailable/ })
    const trigger = getOptionTrigger(option)
    fireEvent.mouseEnter(trigger)

    await waitFor(() => expect(trigger).toHaveAttribute('aria-describedby'))
    const tooltip = getDescribedTooltip(trigger)
    expect(within(tooltip).getByText(
      'workbench.hostLauncher.profiles.routeMissing',
    )).toBeInTheDocument()
    expect(within(tooltip).queryByText(
      'workbench.hostLauncher.profiles.details.direct',
    )).not.toBeInTheDocument()

    fireEvent.click(option)
    expectSelectedProfile('file-ready')
    expect(onRun).not.toHaveBeenCalled()
  })

  it('切换 Host 后回到新 Host 的唯一默认 Profile', async () => {
    const onRun = vi.fn()
    const view = renderAction({
      menu: resolvedMenu([
        profile('ssh-a-default', true, 'host-a'),
        profile('ssh-a-secondary', false, 'host-a'),
      ], 'host-a'),
      onRun,
    })

    openProfileSelect()
    fireEvent.click(await screen.findByRole('option', { name: /ssh-a-secondary/ }))
    await waitFor(() => expectSelectedProfile('ssh-a-secondary'))

    view.rerender(actionElement({
      menu: resolvedMenu([profile('ssh-b-default', true, 'host-b')], 'host-b'),
      onRun,
    }))
    expect(screen.getByText('ssh-b-default')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'app.connect' }))
    expect(onRun).toHaveBeenLastCalledWith(expect.objectContaining({ profileId: 'ssh-b-default' }))
  })

  it('默认项动态变化时跟随最新默认项而不是保留旧值', () => {
    const onRun = vi.fn()
    const view = renderAction({
      menu: resolvedMenu([profile('ssh-old-default', true)]),
      onRun,
    })

    view.rerender(actionElement({
      menu: resolvedMenu([
        profile('ssh-old-default', false),
        profile('ssh-new-default', true),
      ]),
      onRun,
    }))
    expectSelectedProfile('ssh-new-default')

    fireEvent.click(screen.getByRole('button', { name: 'app.connect' }))
    expect(onRun).toHaveBeenLastCalledWith(expect.objectContaining({ profileId: 'ssh-new-default' }))
  })

  it('默认项从正常变为冲突时立即清空自动目标', () => {
    const onRun = vi.fn()
    const view = renderAction({
      menu: resolvedMenu([profile('ssh-a', true)]),
      onRun,
    })

    view.rerender(actionElement({
      menu: {
        hostId: 'host-a',
        intent: 'terminal',
        items: [profile('ssh-a', true), profile('ssh-b', true)],
        defaultItem: null,
        defaultResolution: 'ambiguous',
      },
      onRun,
    }))

    expect(screen.getByText('workbench.hostLauncher.profiles.status.ambiguous')).toBeVisible()
    expect(screen.getByRole('button', { name: 'app.connect' })).toBeDisabled()
    expect(onRun).not.toHaveBeenCalled()
  })

  it('所选 Profile 被删除后回退到仍有效的默认项', async () => {
    const onRun = vi.fn()
    const view = renderAction({
      menu: resolvedMenu([
        profile('ssh-default', true),
        profile('ssh-secondary', false),
      ]),
      onRun,
    })

    openProfileSelect()
    fireEvent.click(await screen.findByRole('option', { name: /ssh-secondary/ }))
    await waitFor(() => expectSelectedProfile('ssh-secondary'))

    view.rerender(actionElement({
      menu: resolvedMenu([profile('ssh-default', true)]),
      onRun,
    }))
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByText('ssh-default')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'app.connect' }))
    expect(onRun).toHaveBeenLastCalledWith(expect.objectContaining({ profileId: 'ssh-default' }))
  })
})

interface RenderActionOptions {
  menu: HostLauncherProfileMenu
  data?: HostLauncherData
  busy?: boolean
  pendingProfileId?: string | null
  onSelect?: (item: HostLauncherProfileMenuItem) => void
  onRun?: (item: HostLauncherProfileMenuItem) => void
  onManage?: () => void
}

function renderAction(options: RenderActionOptions) {
  return render(actionElement(options))
}

function actionElement({
  menu,
  data = emptyLauncherData(),
  busy = false,
  pendingProfileId = null,
  onSelect = vi.fn(),
  onRun = vi.fn(),
  onManage = vi.fn(),
}: RenderActionOptions) {
  return (
    <StatefulProfileAction
      menu={menu}
      data={data}
      busy={busy}
      pendingProfileId={pendingProfileId}
      onSelect={onSelect}
      onRun={onRun}
      onManage={onManage}
    />
  )
}

function StatefulProfileAction({
  menu,
  data,
  busy,
  pendingProfileId,
  onSelect,
  onRun,
  onManage,
}: Required<RenderActionOptions>) {
  const contextKey = `${menu.hostId}:${menu.intent}`
  const [selection, setSelection] = useState({
    contextKey,
    profileId: null as string | null,
  })
  const explicitProfileId = selection.contextKey === contextKey
    ? selection.profileId
    : null
  const explicitItem = explicitProfileId
    ? menu.items.find((item) => item.profileId === explicitProfileId) ?? null
    : null
  const selectedItem = explicitItem?.availability === 'ready'
    ? explicitItem
    : menu.defaultItem

  useEffect(() => {
    setSelection((current) => {
      if (current.contextKey !== contextKey) {
        return { contextKey, profileId: null }
      }
      if (
        current.profileId
        && !menu.items.some((item) => (
          item.profileId === current.profileId && item.availability === 'ready'
        ))
      ) {
        return { contextKey, profileId: null }
      }
      return current
    })
  }, [contextKey, menu.items])

  return (
    <HostLauncherProfileAction
      menu={menu}
      data={data}
      selectedItem={selectedItem}
      busy={busy}
      pendingProfileId={pendingProfileId}
      onSelect={(item) => {
        setSelection({ contextKey, profileId: item.profileId })
        onSelect(item)
      }}
      onRun={onRun}
      onManage={onManage}
    />
  )
}

function emptyLauncherData(): HostLauncherData {
  return {
    hostAssets: [],
    groups: [],
    proxies: [],
    credentials: [],
    hostReachability: {},
    sshAccessProfiles: [],
    fileAccessProfiles: [],
    remoteDesktopProfiles: [],
  }
}

function openProfileSelect() {
  const combobox = screen.getByRole('combobox', {
    name: 'workbench.hostLauncher.profiles.selection',
  })
  fireEvent.mouseDown(combobox)
  return combobox
}

function expectSelectedProfile(name: string) {
  const combobox = screen.getByRole('combobox', {
    name: 'workbench.hostLauncher.profiles.selection',
  })
  const select = combobox.closest('.termous-select')
  if (!(select instanceof HTMLElement)) throw new Error('未找到连接配置选择器')
  expect(within(select).getByText(name)).toBeVisible()
}

function getOptionTrigger(option: HTMLElement) {
  const trigger = option.querySelector('.ant-select-item-option-content')?.firstElementChild
    ?? option.querySelector('.ant-select-item-option-content')
  if (!(trigger instanceof HTMLElement)) throw new Error('未找到连接配置详情触发区域')
  return trigger
}

function getDescribedTooltip(trigger: HTMLElement) {
  const tooltipId = trigger.getAttribute('aria-describedby')
  const tooltip = tooltipId ? document.getElementById(tooltipId) : null
  if (!(tooltip instanceof HTMLElement)) throw new Error('未找到连接配置详情浮层')
  return tooltip
}

function resolvedMenu(
  items: HostLauncherProfileMenuItem[],
  hostId = 'host-a',
): HostLauncherProfileMenu {
  return {
    hostId,
    intent: 'terminal',
    items,
    defaultItem: items.find((item) => item.isDefault) ?? null,
    defaultResolution: 'resolved',
  }
}

function profile(
  id: string,
  isDefault: boolean,
  hostId = 'host-a',
): HostLauncherProfileMenuItem {
  return {
    profileId: id,
    hostId,
    intent: 'terminal',
    actionId: 'connect',
    technology: 'ssh',
    name: id,
    endpoint: `root@${id}.example:22`,
    route: null,
    isDefault,
    sortOrder: isDefault ? 0 : 1,
    availability: 'ready',
  }
}

function fileProfile(
  id: string,
  isDefault: boolean,
  availability: 'ready' | 'route_missing',
): HostLauncherProfileMenuItem {
  return {
    profileId: id,
    hostId: 'host-a',
    intent: 'files',
    actionId: 'openFiles',
    technology: 'sftp',
    name: id,
    endpoint: availability === 'ready' ? 'root@files.example:22' : '',
    route: availability === 'ready' ? {
      profileId: 'ssh-files',
      name: 'Files route',
      endpoint: 'root@files.example:22',
    } : null,
    isDefault,
    sortOrder: isDefault ? 0 : 1,
    availability,
  }
}

function desktopProfile(
  id: string,
  isDefault: boolean,
  route: HostLauncherProfileMenuItem['route'],
): HostLauncherProfileMenuItem {
  return {
    profileId: id,
    hostId: 'host-a',
    intent: 'remote_desktop',
    actionId: 'openRemoteDesktop',
    technology: 'vnc',
    name: id,
    endpoint: '127.0.0.1:5900',
    route,
    isDefault,
    sortOrder: isDefault ? 0 : 1,
    availability: 'ready',
  }
}
