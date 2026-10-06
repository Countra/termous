import { fireEvent, render, screen } from '@testing-library/react'
import { create } from '@bufbuild/protobuf'
import { InventorySchema } from '@termous/remote-protocol'
import { expect, test, vi } from 'vitest'
import { remoteCopy } from '#features/remote-control'
import { RemoteOverview } from './RemoteOverview'

test('快捷连接保留多引擎配置身份并拒绝打开失效授权', () => {
  const inventory = create(InventorySchema, { hosts: [{ id: 'host', name: 'Storage', connections: [
    { id: 'ssh', name: 'deploy', kind: 'ssh', available: true },
    { id: 's3', name: 'Releases', kind: 'files', engine: 's3', available: true },
    { id: 'dav', name: 'Documents', kind: 'files', engine: 'webdav', available: false },
  ] }] })
  const start = vi.fn()
  const props = { inventory, copy: remoteCopy('en-US'), deviceName: 'Desktop', filter: '', disabled: false,
    name: () => '', open: vi.fn(), create: start, showResources: vi.fn() }
  const view = render(<RemoteOverview {...props} />)
  fireEvent.click(screen.getByRole('button', { name: 'Open terminal · Storage · deploy' }))
  expect(start).toHaveBeenLastCalledWith('ssh', 'ssh')
  fireEvent.click(screen.getByRole('button', { name: 'Files' }))
  fireEvent.click(screen.getByRole('button', { name: 'Open files · Storage · Releases' }))
  expect(start).toHaveBeenLastCalledWith('s3', 'files')
  expect(screen.getByRole('button', { name: 'Open files · Storage · Documents' })).toBeDisabled()
  view.rerender(<RemoteOverview {...props} filter="s3" disabled />)
  expect(screen.getByRole('button', { name: 'Open files · Storage · Releases' })).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'Open files · Storage · Documents' })).not.toBeInTheDocument()
})

test('已有会话可按所属主机和文件引擎搜索，搜索忽略首尾空格', () => {
  const inventory = create(InventorySchema, {
    hosts: [{ id: 'host', name: 'Storage' }],
    sessions: [{ id: 'files', hostId: 'host', name: 'Releases', kind: 'files', engine: 's3', state: 'connected' }],
  })
  const props = { inventory, copy: remoteCopy('en-US'), deviceName: 'Desktop', disabled: false,
    name: (session: { name: string }) => session.name, open: vi.fn(), create: vi.fn(), showResources: vi.fn() }
  const view = render(<RemoteOverview {...props} filter=" S3 " />)
  expect(screen.getByRole('button', { name: 'View session · Releases' })).toBeVisible()
  view.rerender(<RemoteOverview {...props} filter="Storage" />)
  fireEvent.click(screen.getByRole('button', { name: 'View session · Releases' }))
  expect(props.open).toHaveBeenCalledWith(inventory.sessions[0])
})
