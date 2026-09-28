import { SettingsModuleStore } from '#entities/settings'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MountSettingsState, MountSettings as MountSettingsValue } from '#common/contracts'
import { MountSettings } from './MountSettings'

const mocks = vi.hoisted(() => ({ t: (key: string) => key, pick: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mocks.t }) }))
vi.mock('#shared/bridge', () => ({ getTermousBridge: () => ({ files: { pickDirectory: mocks.pick } }) }))

const initial: MountSettingsState = {
  cache_directory: '', cache_max_bytes: 10 * 2 ** 30, cache_min_free_bytes: 512 * 2 ** 20,
  default_directory: 'C:/data', active_cache_directory: 'C:/data/cache/vfs', next_cache_directory: 'C:/data/cache/vfs',
  active_cache_max_bytes: 10 * 2 ** 30, active_cache_min_free_bytes: 512 * 2 ** 20, restart_required: false,
}

function adaptMount<T extends { mountSettings(): Promise<MountSettingsState>; updateMountSettings(value: MountSettingsValue): Promise<MountSettingsState> }>(api: T) {
  let revision = 0
  const wrap = (snapshot: MountSettingsState) => {
    const { cache_directory, cache_max_bytes, cache_min_free_bytes, restart_required, ...state } = snapshot
    return { id: 'mount' as const, schema_version: 1, revision: ++revision, value: { cache_directory, cache_max_bytes, cache_min_free_bytes }, state: { ...state, status: restart_required ? 'restart_required' as const : 'applied' as const } }
  }
  const store = new SettingsModuleStore({ read: async () => wrap(await api.mountSettings()), update: async (_id, input) => wrap(await api.updateMountSettings(input.patch as unknown as MountSettingsValue)) })
  return { ...api, getModule: (id: import('#common/contracts').SettingsModuleId) => store.snapshot(id), readModule: (id: import('#common/contracts').SettingsModuleId, signal?: AbortSignal) => store.read(id, signal), updateModule: (id: import('#common/contracts').SettingsModuleId, patch: Record<string, unknown>, options?: { expectedRevision?: number; signal?: AbortSignal }) => store.update(id, patch, options), subscribeSettings: store.subscribe }
}

function setup(snapshot = initial) {
  const gateway = adaptMount({ mountSettings: vi.fn().mockResolvedValue(snapshot), updateMountSettings: vi.fn().mockImplementation(async (settings) => ({ ...initial, ...settings, next_cache_directory: settings.cache_directory ? 'D:/cache/termous-vfs/owner' : initial.active_cache_directory, restart_required: true })) })
  render(<MountSettings gateway={gateway} disabled={false} />)
  return gateway
}

describe('挂载本机缓存设置', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.t = (key: string) => key })

  it('显示默认目录与预算，选择文件夹并保存后仍展示当前生效位置', async () => {
    const gateway = setup()
    await screen.findByDisplayValue('C:/data')
    expect(screen.getByLabelText('settings.mount.capacity')).toHaveValue('10')
    expect(screen.getByLabelText('settings.mount.reserve')).toHaveValue('512')
    expect(screen.getByRole('button', { name: 'app.save' })).toBeDisabled()
    fireEvent.click(screen.getByText('settings.mount.custom'))
    expect(screen.getByRole('button', { name: 'app.save' })).toBeDisabled()
    mocks.pick.mockResolvedValue(['D:/cache'])
    fireEvent.click(screen.getByRole('button', { name: 'settings.mount.choose' }))
    await screen.findByDisplayValue('D:/cache')
    fireEvent.change(screen.getByLabelText('settings.mount.capacity'), { target: { value: '20' } })
    fireEvent.change(screen.getByLabelText('settings.mount.reserve'), { target: { value: '1024' } })
    fireEvent.click(screen.getByRole('button', { name: 'app.save' }))
    await waitFor(() => expect(gateway.updateMountSettings).toHaveBeenCalledWith({ cache_directory: 'D:/cache', cache_max_bytes: 20 * 2 ** 30, cache_min_free_bytes: 1024 * 2 ** 20 }))
    await screen.findByText('settings.mount.pending')
    expect(screen.getByText('C:/data/cache/vfs')).toBeInTheDocument()
    expect(screen.getByText('D:/cache/termous-vfs/owner')).toBeInTheDocument()
  })

  it('保存失败保留输入，不把未保存值显示为已生效', async () => {
    const gateway = setup()
    await screen.findByDisplayValue('C:/data')
    gateway.updateMountSettings.mockRejectedValue(new Error('directory is not writable'))
    fireEvent.click(screen.getByText('settings.mount.custom'))
    fireEvent.change(screen.getByRole('textbox', { name: 'settings.mount.directory' }), { target: { value: 'D:/readonly' } })
    fireEvent.click(screen.getByRole('button', { name: 'app.save' }))
    await screen.findByText('directory is not writable')
    expect(screen.getByDisplayValue('D:/readonly')).toBeInTheDocument()
    expect(screen.queryByText('settings.mount.pending')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'app.save' })).toBeEnabled()
  })

  it('恢复默认只清空目录，不重置单独配置的空间预算', async () => {
    const gateway = setup({ ...initial, cache_directory: 'D:/cache', cache_max_bytes: 30 * 2 ** 30 })
    await screen.findByDisplayValue('D:/cache')
    fireEvent.click(screen.getByText('settings.mount.default'))
    fireEvent.click(screen.getByRole('button', { name: 'app.save' }))
    await waitFor(() => expect(gateway.updateMountSettings).toHaveBeenCalledWith({ cache_directory: '', cache_max_bytes: 30 * 2 ** 30, cache_min_free_bytes: 512 * 2 ** 20 }))
    expect(mocks.pick).not.toHaveBeenCalled()
  })

  it('切换语言不重新请求或覆盖未保存输入', async () => {
    const gateway = adaptMount({ mountSettings: vi.fn().mockResolvedValue(initial), updateMountSettings: vi.fn() })
    const view = render(<MountSettings gateway={gateway} disabled={false} />)
    await screen.findByDisplayValue('C:/data')
    fireEvent.change(screen.getByLabelText('settings.mount.capacity'), { target: { value: '20' } })
    mocks.t = (key: string) => key
    await act(async () => view.rerender(<MountSettings gateway={gateway} disabled={false} />))
    expect(gateway.mountSettings).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('settings.mount.capacity')).toHaveValue('20')
  })

  it('切换 Core 后加载失败，不能使用旧 Core 的设置继续保存', async () => {
    const gateway = adaptMount({ mountSettings: vi.fn().mockResolvedValue(initial), updateMountSettings: vi.fn() })
    const view = render(<MountSettings gateway={gateway} disabled={false} />)
    await screen.findByDisplayValue('C:/data')
    fireEvent.change(screen.getByLabelText('settings.mount.capacity'), { target: { value: '20' } })
    const nextGateway = adaptMount({ mountSettings: vi.fn().mockRejectedValue(new Error('Core unavailable')), updateMountSettings: vi.fn() })
    view.rerender(<MountSettings gateway={nextGateway} disabled={false} />)
    await screen.findByText('Core unavailable')
    expect(screen.queryByText('C:/data/cache/vfs')).not.toBeInTheDocument()
    expect(screen.getByLabelText('settings.mount.capacity')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'app.save' })).toBeDisabled()
    expect(nextGateway.updateMountSettings).not.toHaveBeenCalled()
  })

  it('切换 Core 后忽略旧 Core 迟到的保存结果', async () => {
    let finishSave!: (value: MountSettingsState) => void
    const saving = new Promise<MountSettingsState>((resolve) => { finishSave = resolve })
    const gateway = adaptMount({ mountSettings: vi.fn().mockResolvedValue(initial), updateMountSettings: vi.fn().mockReturnValue(saving) })
    const view = render(<MountSettings gateway={gateway} disabled={false} />)
    await screen.findByDisplayValue('C:/data')
    fireEvent.change(screen.getByLabelText('settings.mount.capacity'), { target: { value: '20' } })
    fireEvent.click(screen.getByRole('button', { name: 'app.save' }))
    await waitFor(() => expect(gateway.updateMountSettings).toHaveBeenCalledTimes(1))

    const nextGateway = adaptMount({ mountSettings: vi.fn().mockResolvedValue({ ...initial, default_directory: 'E:/data' }), updateMountSettings: vi.fn() })
    view.rerender(<MountSettings gateway={nextGateway} disabled={false} />)
    await screen.findByDisplayValue('E:/data')
    fireEvent.change(screen.getByLabelText('settings.mount.capacity'), { target: { value: '30' } })
    await act(async () => finishSave({ ...initial, cache_max_bytes: 20 * 2 ** 30, restart_required: true }))
    expect(screen.getByDisplayValue('E:/data')).toBeInTheDocument()
    expect(screen.getByLabelText('settings.mount.capacity')).toHaveValue('30')
    expect(screen.queryByText('settings.mount.pending')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'app.save' })).toBeEnabled()
    expect(nextGateway.updateMountSettings).not.toHaveBeenCalled()
  })

  it('撤回待生效修改后不再提示重启', async () => {
    const gateway = setup({ ...initial, cache_max_bytes: 20 * 2 ** 30, restart_required: true })
    gateway.updateMountSettings.mockResolvedValue(initial)
    await screen.findByDisplayValue('C:/data')
    await waitFor(() => expect(screen.getByLabelText('settings.mount.capacity')).toHaveValue('20'))
    fireEvent.change(screen.getByLabelText('settings.mount.capacity'), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: 'app.save' }))
    await screen.findByText('settings.mount.saved')
    expect(screen.queryByText('settings.mount.pending')).not.toBeInTheDocument()
    expect(screen.queryByText('settings.mount.savedPending')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'app.save' })).toBeDisabled()
  })
})
