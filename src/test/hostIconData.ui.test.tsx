import type { SetStateAction } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { HostIcon } from '#entities/host'
import { loadAppDataSnapshot } from '../app/data-runtime/api/appDataSnapshotGateway'
import type {
  AppDataSnapshotGateway,
  HostCommandGateway,
} from '../app/data-runtime/api/runtimeGatewayContracts'
import { createHostCommands } from '../app/data-runtime/commands/hostCommands'
import type { AppData } from '../app/data-runtime/model/appData'
import { initialData } from '../app/data-runtime/model/appDataState'

function hostIcon(id: string, displayName: string, sortOrder: number): HostIcon {
  return {
    id,
    display_name: displayName,
    file_name: `${id}.png`,
    mime_type: 'image/png',
    size_bytes: 128,
    sha256: `sha-${id}`,
    sort_order: sortOrder,
    created_at: '2026-08-11T00:00:00Z',
  }
}

describe('主机图标数据合同', () => {
  it('应用快照包含独立的主机图标列表', async () => {
    const calls: string[] = []
    const values = {
      settings: { language: 'zh-CN' },
      terminalFonts: [],
      codeSnippetGroups: [],
      codeSnippets: [],
      fileBookmarkGroups: [],
      fileBookmarks: [],
      localPathMappings: [],
      hostGroups: [],
      hostIcons: [hostIcon('icon-a', 'Alpha', 0)],
      connectionProxies: [],
      hosts: [],
      hostReachability: [],
      credentials: [],
      sessions: [],
      fileSessions: [],
      fileAccessProfiles: [],
      forwardProfiles: [],
      forwards: [],
      remoteDesktopProfiles: [],
      remoteDesktopSessions: [],
    }
    const gateway = Object.fromEntries(Object.entries(values).map(([key, value]) => [
      key,
      vi.fn(async () => {
        calls.push(key)
        return value
      }),
    ])) as unknown as AppDataSnapshotGateway

    const snapshot = await loadAppDataSnapshot(gateway)

    expect(calls).toContain('hostIcons')
    expect(snapshot[8]).toEqual([hostIcon('icon-a', 'Alpha', 0)])
  })

  it('上传按 ID upsert，改名、排序和删除使用后端确认结果更新状态', async () => {
    const iconA = hostIcon('icon-a', 'Alpha', 1)
    const iconB = hostIcon('icon-b', 'Beta', 0)
    const renamedB = { ...iconB, display_name: 'Backend' }
    const reordered = [
      { ...iconA, sort_order: 0 },
      { ...renamedB, sort_order: 1 },
    ]
    const api = {
      uploadHostIcon: vi.fn()
        .mockResolvedValueOnce(iconB)
        .mockResolvedValueOnce({ ...iconA, display_name: 'Alpha Updated' }),
      renameHostIcon: vi.fn().mockResolvedValue(renamedB),
      reorderHostIcons: vi.fn().mockResolvedValue(reordered),
      deleteHostIcon: vi.fn().mockResolvedValue(undefined),
    } as unknown as HostCommandGateway
    let data: AppData = { ...initialData, hostIcons: [iconA] }
    const setData = (update: SetStateAction<AppData>) => {
      data = typeof update === 'function' ? update(data) : update
    }
    const commands = createHostCommands({
      api,
      hosts: [],
      load: vi.fn(),
      setData,
    })

    await commands.uploadHostIcon(new File(['beta'], 'beta.png', { type: 'image/png' }))
    expect(data.hostIcons.map((icon) => icon.id)).toEqual(['icon-b', 'icon-a'])

    await commands.uploadHostIcon(new File(['alpha'], 'alpha.png', { type: 'image/png' }))
    expect(data.hostIcons).toHaveLength(2)
    expect(data.hostIcons.find((icon) => icon.id === 'icon-a')?.display_name).toBe('Alpha Updated')

    await commands.renameHostIcon('icon-b', 'Backend')
    expect(data.hostIcons[0]?.display_name).toBe('Backend')

    await commands.reorderHostIcons(reordered.map(({ id, sort_order }) => ({ id, sort_order })))
    expect(data.hostIcons.map((icon) => icon.id)).toEqual(['icon-a', 'icon-b'])

    await commands.deleteHostIcon('icon-a')
    expect(data.hostIcons.map((icon) => icon.id)).toEqual(['icon-b'])
    expect(data.hostIcons[0]?.sort_order).toBe(0)
  })

  it('请求失败时不提前修改主机图标状态', async () => {
    const icon = hostIcon('icon-a', 'Alpha', 0)
    const api = {
      uploadHostIcon: vi.fn().mockRejectedValue(new Error('upload failed')),
      renameHostIcon: vi.fn().mockRejectedValue(new Error('rename failed')),
      reorderHostIcons: vi.fn().mockRejectedValue(new Error('reorder failed')),
      deleteHostIcon: vi.fn().mockRejectedValue(new Error('delete failed')),
    } as unknown as HostCommandGateway
    let data: AppData = { ...initialData, hostIcons: [icon] }
    const setData = (update: SetStateAction<AppData>) => {
      data = typeof update === 'function' ? update(data) : update
    }
    const commands = createHostCommands({ api, hosts: [], load: vi.fn(), setData })

    await expect(commands.renameHostIcon(icon.id, 'Changed')).rejects.toThrow('rename failed')
    await expect(commands.reorderHostIcons([{ id: icon.id, sort_order: 2 }])).rejects.toThrow('reorder failed')
    await expect(commands.deleteHostIcon(icon.id)).rejects.toThrow('delete failed')
    expect(data.hostIcons).toEqual([icon])
  })
})
