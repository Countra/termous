import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { MountCacheState } from '#common/contracts'
import { MountCacheUsage } from './MountCacheUsage'

const mocks = vi.hoisted(() => ({ t: (key: string) => key }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mocks.t }) }))

const state: MountCacheState = {
  persistent: true, limit_bytes: 10 * 2 ** 30, used_bytes: 1024, clean_bytes: 1024,
  private_bytes: 0, reclaimable_bytes: 1024, index_bytes: 0, clear: { id: '', state: 'idle', freed_bytes: 0 },
}

describe('持久挂载缓存管理', () => {
  it('受理清理后展示执行状态，不提前显示已完成', async () => {
    const accepted = { id: 'task', state: 'accepted' as const, freed_bytes: 0 }
    const gateway = { mountSettings: vi.fn(), updateMountSettings: vi.fn(), mountCache: vi.fn().mockResolvedValue(state), clearMountCache: vi.fn().mockResolvedValue(accepted) }
    render(<MountCacheUsage gateway={gateway} disabled={false} />)
    const button = await screen.findByRole('button', { name: 'settings.mount.clearUnused' })
    await waitFor(() => expect(button).toBeEnabled())
    gateway.mountCache.mockResolvedValue({ ...state, clear: { ...accepted, state: 'running' } })
    fireEvent.click(button)
    await screen.findByText('settings.mount.clearState.running')
    expect(screen.queryByText('settings.mount.clearState.completed')).not.toBeInTheDocument()
    expect(button).toBeDisabled()
    expect(gateway.clearMountCache).toHaveBeenCalledTimes(1)
  })

  it('展示缓存降级原因，清理请求失败保留原容量', async () => {
    const gateway = { mountSettings: vi.fn(), updateMountSettings: vi.fn(), mountCache: vi.fn().mockResolvedValue({ ...state, warning: '索引不可写' }), clearMountCache: vi.fn().mockRejectedValue(new Error('清理未完成')) }
    render(<MountCacheUsage gateway={gateway} disabled={false} />)
    await screen.findByText('索引不可写')
    fireEvent.click(screen.getByRole('button', { name: 'settings.mount.clearUnused' }))
    await screen.findByText('清理未完成')
    expect(screen.getAllByText('1.0 KB')).toHaveLength(2)
  })
})
