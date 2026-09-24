import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { describe, expect, it, vi } from 'vitest'
import { MountEditor } from './MountEditor'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, data?: { count?: number }) => `${key}${data?.count === undefined ? '' : ` ${data.count}`}` }) }))

function setup(temporary = false) {
  const submit = vi.fn()
  const profile = { id: 'saved', name: 'Archive', description: '', file_profile_id: 'source', target_os: 'windows', mount_point: 'T:', volume_name: 'Archive', read_only: false, case_sensitive: false, attribute_ttl_seconds: 5, directory_ttl_seconds: 60, metadata_concurrency: 0, auto_start: false, created_at: '', updated_at: '2026-09-24T00:00:00Z' }
  render(<ConfigProvider theme={{ token: { motion: false } }}><MountEditor
    profile={profile} temporary={temporary} busy={false}
    environment={{ platform: 'windows', architecture: 'amd64', available: true, build_supported: true, dependency: 'WinFsp', message: '', free_drives: ['T:'] }}
    hosts={[]} fileProfiles={[]} onClose={vi.fn()} onSubmit={submit} onError={vi.fn()}
  /></ConfigProvider>)
  fireEvent.click(screen.getByText('mounts.advanced'))
  return submit
}

describe('挂载高级选项', () => {
  it.each([false, true])('保存目录缓存与并发选项，临时模式为 %s', async (temporary) => {
    const submit = setup(temporary)
    fireEvent.change(screen.getByRole('spinbutton', { name: 'mounts.directoryCache' }), { target: { value: '7' } })
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'mounts.metadataConcurrency' }))
    fireEvent.click(await screen.findByText('mounts.concurrentRequests 2'))
    fireEvent.click(screen.getByRole('button', { name: temporary ? 'mounts.start' : 'app.save' }))
    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ directory_ttl_seconds: 7, metadata_concurrency: 2, attribute_ttl_seconds: 5 })))
    expect(screen.getByText('mounts.directoryCacheHint')).toBeInTheDocument()
  })

  it('清空缓存时间时阻止提交并显示范围', async () => {
    const submit = setup()
    fireEvent.change(screen.getByRole('spinbutton', { name: 'mounts.directoryCache' }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'app.save' }))
    await screen.findByText('mounts.directoryCacheRange')
    expect(submit).not.toHaveBeenCalled()
  })
})
