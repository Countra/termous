import { expect, test, vi } from 'vitest'
import type {
  RemoteDesktopProfile,
  RemoteDesktopProfileInput,
} from '#entities/remote-desktop'
import type { RemoteDesktopGateway } from '#features/remote-desktop'
import { TermousApiError } from '#shared/api'
import { initialData } from '../model/appDataState'
import { createRemoteDesktopProfileCommands } from './remoteDesktopProfileCommands'

const input: RemoteDesktopProfileInput = {
  name: 'Desktop B',
  description: '',
  protocol: 'vnc',
  transport: 'ssh_tunnel',
  ssh_host_id: 'hst_test',
  vnc: {
    loopback_host: '127.0.0.1',
    port: 5900,
    shared: true,
    default_view_only: false,
    default_display_mode: 'fit',
  },
}

test('配置创建和更新按 ID 合并并保持稳定排序', async () => {
  const profileA = profile('rdp_a', 'Desktop A')
  const profileB = profile('rdp_b', 'Desktop B')
  let data = { ...initialData, remoteDesktopProfiles: [profileB] }
  const api = {
    createRemoteDesktopProfile: vi.fn(async () => profileB),
    updateRemoteDesktopProfile: vi.fn(async () => profileA),
    deleteRemoteDesktopProfile: vi.fn(async () => undefined),
  }
  const commands = createRemoteDesktopProfileCommands(
    api as Pick<RemoteDesktopGateway, 'createRemoteDesktopProfile' | 'updateRemoteDesktopProfile' | 'deleteRemoteDesktopProfile'>,
    [profileA, profileB],
    (next) => {
      data = typeof next === 'function' ? next(data) : next
    },
    vi.fn(),
  )

  await commands.createRemoteDesktopProfile(input)
  expect(data.remoteDesktopProfiles).toEqual([profileB])

  await commands.updateRemoteDesktopProfile(profileA.id, input)
  expect(api.updateRemoteDesktopProfile).toHaveBeenCalledWith(
    profileA.id,
    profileA.updated_at,
    input,
  )
  expect(data.remoteDesktopProfiles).toEqual([profileA, profileB])

  await commands.deleteRemoteDesktopProfile(profileB.id)
  expect(api.deleteRemoteDesktopProfile).toHaveBeenCalledWith(
    profileB.id,
    profileB.updated_at,
  )
  expect(data.remoteDesktopProfiles).toEqual([profileA])
})

test('配置缺少版本时在发起写请求前失败', async () => {
  const api = {
    createRemoteDesktopProfile: vi.fn(),
    updateRemoteDesktopProfile: vi.fn(),
    deleteRemoteDesktopProfile: vi.fn(),
  }
  const commands = createRemoteDesktopProfileCommands(
    api as Pick<RemoteDesktopGateway, 'createRemoteDesktopProfile' | 'updateRemoteDesktopProfile' | 'deleteRemoteDesktopProfile'>,
    [],
    vi.fn(),
    vi.fn(),
  )

  await expect(commands.updateRemoteDesktopProfile('rdp_missing', input))
    .rejects.toThrow('远程桌面配置不存在或缺少版本信息')
  await expect(commands.deleteRemoteDesktopProfile('rdp_missing'))
    .rejects.toThrow('远程桌面配置不存在或缺少版本信息')
  expect(api.updateRemoteDesktopProfile).not.toHaveBeenCalled()
  expect(api.deleteRemoteDesktopProfile).not.toHaveBeenCalled()
})

test('CAS 冲突后刷新权威配置并允许使用新版本重试', async () => {
  const stale = profile('rdp_a', 'Desktop A')
  const current = { ...stale, updated_at: '2026-08-23T12:00:01Z' }
  const saved = { ...current, name: 'Desktop B', updated_at: '2026-08-23T12:00:02Z' }
  const conflict = new TermousApiError('conflict', 'REMOTE_DESKTOP_PROFILE_CONFLICT', 409)
  const api = {
    createRemoteDesktopProfile: vi.fn(),
    updateRemoteDesktopProfile: vi.fn()
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce(saved),
    deleteRemoteDesktopProfile: vi.fn()
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce(undefined),
  }
  const load = vi.fn().mockResolvedValue(undefined)
  const setData = vi.fn()
  const staleCommands = createRemoteDesktopProfileCommands(
    api as Pick<RemoteDesktopGateway, 'createRemoteDesktopProfile' | 'updateRemoteDesktopProfile' | 'deleteRemoteDesktopProfile'>,
    [stale],
    setData,
    load,
  )

  await expect(staleCommands.updateRemoteDesktopProfile(stale.id, input)).rejects.toBe(conflict)
  await expect(staleCommands.deleteRemoteDesktopProfile(stale.id)).rejects.toBe(conflict)
  expect(load).toHaveBeenCalledTimes(2)
  expect(load).toHaveBeenNthCalledWith(1, 'silent')
  expect(load).toHaveBeenNthCalledWith(2, 'silent')

  const currentCommands = createRemoteDesktopProfileCommands(
    api as Pick<RemoteDesktopGateway, 'createRemoteDesktopProfile' | 'updateRemoteDesktopProfile' | 'deleteRemoteDesktopProfile'>,
    [current],
    setData,
    load,
  )
  await currentCommands.updateRemoteDesktopProfile(current.id, input)
  await currentCommands.deleteRemoteDesktopProfile(current.id)
  expect(api.updateRemoteDesktopProfile).toHaveBeenLastCalledWith(current.id, current.updated_at, input)
  expect(api.deleteRemoteDesktopProfile).toHaveBeenLastCalledWith(current.id, current.updated_at)
})

function profile(id: string, name: string): RemoteDesktopProfile {
  return {
    id,
    name,
    description: '',
    protocol: 'vnc',
    transport: 'ssh_tunnel',
    ssh_host_id: 'hst_test',
    vnc: { ...input.vnc },
    created_at: '2026-08-23T12:00:00Z',
    updated_at: '2026-08-23T12:00:00Z',
  }
}
