import { fireEvent, render, screen } from '@testing-library/react'
import { create } from '@bufbuild/protobuf'
import { HostSchema } from '@termous/remote-protocol'
import { expect, test, vi } from 'vitest'
import { remoteCopy } from '#features/remote-control'
import { RemoteHostList } from './RemoteHostList'

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
