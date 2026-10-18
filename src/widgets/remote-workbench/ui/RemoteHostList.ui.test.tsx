import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { create } from '@bufbuild/protobuf'
import { HostIconSchema, HostSchema } from '@termous/remote-protocol'
import { expect, test, vi } from 'vitest'
import { remoteCopy } from '#features/remote-control'
import { RemoteError, RemoteHostIcons } from '#entities/remote-control'
import { RemoteHostList } from './RemoteHostList'
import { RemoteHostIcon } from './RemoteHostIcon'

test('按主机展示独立的终端和多引擎文件连接，禁止打开已失效配置', () => {
  const open = vi.fn()
  const hosts = [create(HostSchema, { id: 'host', name: 'Storage', connections: [
    { id: 'ssh', name: 'deploy', kind: 'ssh', available: true },
    { id: 's3', name: 'Releases', kind: 'files', engine: 's3', available: true },
    { id: 'dav', name: 'Documents', kind: 'files', engine: 'webdav', available: false },
  ] })]
  const copy = remoteCopy('en-US')
  const view = render(<RemoteHostList hosts={hosts} filter="" disabled={false} copy={copy} create={open} />)
  fireEvent.click(screen.getByRole('button', { name: `${copy.newFiles} · Storage · Releases` }))
  expect(open).toHaveBeenCalledWith('s3', 'files')
  fireEvent.click(screen.getByRole('button', { name: `${copy.newTerminal} · Storage · deploy` }))
  expect(open).toHaveBeenCalledWith('ssh', 'ssh')
  expect(screen.getByRole('button', { name: `${copy.newFiles} · Storage · Documents` })).toBeDisabled()
  view.rerender(<RemoteHostList hosts={hosts} filter="s3" disabled={false} copy={copy} create={open} />)
  expect(screen.queryByRole('button', { name: `${copy.newTerminal} · Storage · deploy` })).toBeNull()
  expect(screen.getByText('Storage')).toBeVisible()
})

test('自定义图标展示于主机左侧，替换和移除立即失效旧图标，失败回退', async () => {
  const createURL = vi.fn().mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:next')
  const revoke = vi.fn()
  vi.stubGlobal('URL', class extends URL { static createObjectURL = createURL; static revokeObjectURL = revoke })
  const icons = new RemoteHostIcons(async ({ iconId }) => create(HostIconSchema, {
    iconId, mimeType: 'image/svg+xml', totalBytes: 1, data: new Uint8Array([1]),
  }))
  const host = create(HostSchema, { id: 'host', name: 'Server', iconId: 'icon' })
  const props = { icons, filter: '', disabled: false, copy: remoteCopy('en-US'), create: vi.fn() }
  const view = render(<RemoteHostList {...props} hosts={[host]} />)
  try {
    await waitFor(() => expect(view.container.querySelector('img')).toHaveAttribute('src', 'blob:first'))
    expect(screen.getByRole('button', { name: 'Server' }).querySelector('img')).not.toBeNull()
    view.rerender(<RemoteHostList {...props} hosts={[{ ...host, iconId: 'next' }]} />)
    expect(view.container.querySelector('img')).toBeNull()
    await waitFor(() => expect(view.container.querySelector('img')).toHaveAttribute('src', 'blob:next'))
    expect(revoke).toHaveBeenCalledWith('blob:first')
    fireEvent.error(view.container.querySelector('img')!)
    expect(view.container.querySelector('img')).toBeNull()
    view.rerender(<RemoteHostList {...props} hosts={[{ ...host, iconId: '' }]} />)
    expect(createURL).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'Server' })).toHaveAttribute('aria-expanded', 'true')
  } finally { view.unmount(); icons.dispose(); vi.unstubAllGlobals() }
  expect(revoke).toHaveBeenCalledWith('blob:next')
})

test('搜索临时展开已折叠主机，清空搜索后保留原折叠状态', () => {
  const hosts = [create(HostSchema, { id: 'host', name: 'Storage', connections: [
    { id: 'ssh', name: 'deploy', kind: 'ssh', available: true },
    { id: 's3', name: 'Releases', kind: 'files', engine: 's3', available: true },
  ] })]
  const props = { hosts, disabled: false, copy: remoteCopy('en-US'), create: vi.fn() }
  const view = render(<RemoteHostList {...props} filter="" />)
  fireEvent.click(screen.getByRole('button', { name: 'Storage' }))
  expect(screen.queryByRole('button', { name: 'Open files · Storage · Releases' })).not.toBeInTheDocument()
  view.rerender(<RemoteHostList {...props} filter="s3" />)
  expect(screen.getByRole('button', { name: 'Open files · Storage · Releases' })).toBeVisible()
  view.rerender(<RemoteHostList {...props} filter="" />)
  expect(screen.getByRole('button', { name: 'Storage' })).toHaveAttribute('aria-expanded', 'false')
})

test('短暂失败有限补读，成功恢复图标，卸载停止等待中的重试', async () => {
  vi.useFakeTimers()
  const revoke = vi.fn()
  vi.stubGlobal('URL', class extends URL { static createObjectURL = () => 'blob:recovered'; static revokeObjectURL = revoke })
  const read = vi.fn().mockRejectedValueOnce(new RemoteError('remote_request_timeout')).mockResolvedValue(create(HostIconSchema, {
    iconId: 'icon', mimeType: 'image/png', totalBytes: 1, data: new Uint8Array([1]),
  }))
  const icons = new RemoteHostIcons(read)
  const failingRead = vi.fn().mockRejectedValue(new RemoteError('remote_send_failed'))
  const failing = new RemoteHostIcons(failingRead)
  const view = render(<RemoteHostIcon hostId="host" iconId="icon" icons={icons} />)
  try {
    await act(async () => {})
    expect(read).toHaveBeenCalledTimes(1)
    await act(() => vi.advanceTimersByTimeAsync(400))
    expect(read).toHaveBeenCalledTimes(2)
    expect(view.container.querySelector('img')).toHaveAttribute('src', 'blob:recovered')
    view.rerender(<RemoteHostIcon hostId="host" iconId="icon" icons={failing} />)
    await act(async () => {})
    await act(() => vi.advanceTimersByTimeAsync(2000))
    expect(failingRead).toHaveBeenCalledTimes(3)
    await act(() => vi.advanceTimersByTimeAsync(30000))
    expect(failingRead).toHaveBeenCalledTimes(3)
    view.rerender(<RemoteHostIcon hostId="other" iconId="icon" icons={failing} />)
    await act(async () => {})
    view.unmount()
    await act(() => vi.advanceTimersByTimeAsync(2000))
    expect(failingRead).toHaveBeenCalledTimes(4)
    expect(revoke).toHaveBeenCalledWith('blob:recovered')
  } finally { view.unmount(); icons.dispose(); failing.dispose(); vi.useRealTimers(); vi.unstubAllGlobals() }
})

test('权限拒绝不自动重试，默认图标不妨碍主机展开', async () => {
  vi.useFakeTimers()
  const read = vi.fn().mockRejectedValue(new RemoteError('remote_resource_forbidden'))
  const icons = new RemoteHostIcons(read)
  const view = render(<RemoteHostList hosts={[create(HostSchema, { id: 'host', name: 'Server', iconId: 'icon' })]}
    icons={icons} filter="" disabled={false} copy={remoteCopy('en-US')} create={vi.fn()} />)
  try {
    await act(async () => {})
    await act(() => vi.advanceTimersByTimeAsync(10000))
    expect(read).toHaveBeenCalledTimes(1)
    expect(view.container.querySelector('img')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Server' }))
    expect(screen.getByRole('button', { name: 'Server' })).toHaveAttribute('aria-expanded', 'false')
  } finally { view.unmount(); icons.dispose(); vi.useRealTimers() }
})
