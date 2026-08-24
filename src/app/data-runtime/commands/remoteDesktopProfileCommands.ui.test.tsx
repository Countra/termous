import { expect, test, vi } from 'vitest'
import type {
  RemoteDesktopProfile,
  RemoteDesktopProfileInput,
} from '#entities/remote-desktop'
import type { RemoteDesktopGateway } from '#features/remote-desktop'
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
    (next) => {
      data = typeof next === 'function' ? next(data) : next
    },
  )

  await commands.createRemoteDesktopProfile(input)
  expect(data.remoteDesktopProfiles).toEqual([profileB])

  await commands.updateRemoteDesktopProfile(profileA.id, input)
  expect(data.remoteDesktopProfiles).toEqual([profileA, profileB])

  await commands.deleteRemoteDesktopProfile(profileB.id)
  expect(data.remoteDesktopProfiles).toEqual([profileA])
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
