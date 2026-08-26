import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  HostLauncherProfileMenu,
  HostLauncherProfileMenuItem,
} from '../model/hostLauncherProfiles.ts'
import { HostLauncherProfileAction } from './HostLauncherProfileAction.tsx'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe('HostLauncherProfileAction', () => {
  it('单 Profile 直接执行默认项且不展示次级菜单', () => {
    const onRun = vi.fn()
    render(
      <HostLauncherProfileAction
        menu={resolvedMenu([profile('ssh-default', true)])}
        busy={false}
        pendingProfileId={null}
        onRun={onRun}
        onManage={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', {
      name: 'workbench.hostLauncher.profiles.more.terminal',
    })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'app.connect' }))
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'ssh-default' }))
  })

  it('多 Profile 才展示紧凑菜单且精确执行所选项', async () => {
    const onRun = vi.fn()
    render(
      <HostLauncherProfileAction
        menu={resolvedMenu([
          profile('ssh-default', true),
          profile('ssh-secondary', false),
        ])}
        busy={false}
        pendingProfileId={null}
        onRun={onRun}
        onManage={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', {
      name: 'workbench.hostLauncher.profiles.more.terminal',
    }))
    const secondary = await screen.findByRole('menuitem', { name: /ssh-secondary/ })
    fireEvent.click(secondary)

    await waitFor(() => expect(onRun).toHaveBeenCalledWith(
      expect.objectContaining({ profileId: 'ssh-secondary' }),
    ))
  })

  it('默认项异常时阻止主动作但保留显式选择和管理入口', async () => {
    const onRun = vi.fn()
    const onManage = vi.fn()
    const items = [profile('ssh-a', true), profile('ssh-b', true)]
    const menu: HostLauncherProfileMenu = {
      hostId: 'host-a',
      intent: 'terminal',
      items,
      defaultItem: null,
      defaultResolution: 'ambiguous',
    }
    render(
      <HostLauncherProfileAction
        menu={menu}
        busy={false}
        pendingProfileId={null}
        onRun={onRun}
        onManage={onManage}
      />,
    )

    expect(screen.getByRole('button', { name: 'app.connect' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', {
      name: 'workbench.hostLauncher.profiles.manage',
    }))
    expect(onManage).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', {
      name: 'workbench.hostLauncher.profiles.more.terminal',
    }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /ssh-b/ }))
    await waitFor(() => expect(onRun).toHaveBeenCalledWith(
      expect.objectContaining({ profileId: 'ssh-b' }),
    ))
  })

  it('单个可用 Profile 缺少默认标记时仍保留显式选择入口', async () => {
    const onRun = vi.fn()
    const onlyProfile = profile('ssh-only', false)
    render(
      <HostLauncherProfileAction
        menu={{
          hostId: 'host-a',
          intent: 'terminal',
          items: [onlyProfile],
          defaultItem: null,
          defaultResolution: 'missing',
        }}
        busy={false}
        pendingProfileId={null}
        onRun={onRun}
        onManage={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'app.connect' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', {
      name: 'workbench.hostLauncher.profiles.more.terminal',
    }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /ssh-only/ }))

    await waitFor(() => expect(onRun).toHaveBeenCalledWith(
      expect.objectContaining({ profileId: 'ssh-only' }),
    ))
  })

  it('路由不可用的 Profile 不允许从主按钮或菜单执行', async () => {
    const onRun = vi.fn()
    const unavailable = fileProfile('file-unavailable', true, 'route_missing')
    const ready = fileProfile('file-ready', false, 'ready')
    const menu: HostLauncherProfileMenu = {
      hostId: 'host-a',
      intent: 'files',
      items: [unavailable, ready],
      defaultItem: unavailable,
      defaultResolution: 'unavailable',
    }
    render(
      <HostLauncherProfileAction
        menu={menu}
        busy={false}
        pendingProfileId={null}
        onRun={onRun}
        onManage={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'workbench.hostLauncher.openFiles' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', {
      name: 'workbench.hostLauncher.profiles.more.files',
    }))
    expect(await screen.findByRole('menuitem', { name: /file-unavailable/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(onRun).not.toHaveBeenCalled()
  })
})

function resolvedMenu(items: HostLauncherProfileMenuItem[]): HostLauncherProfileMenu {
  return {
    hostId: 'host-a',
    intent: 'terminal',
    items,
    defaultItem: items.find((item) => item.isDefault) ?? null,
    defaultResolution: 'resolved',
  }
}

function profile(id: string, isDefault: boolean): HostLauncherProfileMenuItem {
  return {
    profileId: id,
    hostId: 'host-a',
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
