import { create } from '@bufbuild/protobuf'
import { HostIconSchema } from '@termous/remote-protocol'
import { expect, test, vi } from 'vitest'
import { RemoteHostIcons } from './hostIcons'

test('图标分块完整组装，同一连接合并读取并复用缓存', async () => {
  const data = new Uint8Array(32771).fill(7)
  const read = vi.fn(async ({ iconId, offset }: { iconId: string; offset: number }) => create(HostIconSchema, {
    iconId, offset, mimeType: 'image/png', totalBytes: data.length, data: data.slice(offset, offset + 16384),
  }))
  const icons = new RemoteHostIcons(read)
  const first = icons.load('host', 'icon')
  expect(icons.load('host', 'icon')).toBe(first)
  const blob = await first
  expect(blob.size).toBe(data.length)
  expect(blob.type).toBe('image/png')
  expect(await icons.load('host', 'icon')).toBe(blob)
  expect(read.mock.calls.map(([value]) => value.offset)).toEqual([0, 16384, 32768])
  await icons.load('host', 'replacement')
  expect(read).toHaveBeenCalledTimes(6)
  icons.dispose()
  await expect(icons.load('host', 'icon')).rejects.toThrow('remote_host_icon_unavailable')
})

test('格式错误、越界和版本变化不能进入图标缓存', async () => {
  for (const patch of [
    { iconId: 'other' }, { offset: 1 }, { totalBytes: 0 }, { totalBytes: 5 * 1024 * 1024 + 1 },
    { mimeType: 'text/html' }, { data: new Uint8Array() },
  ]) {
    const icons = new RemoteHostIcons(async () => create(HostIconSchema, {
      iconId: 'icon', mimeType: 'image/png', totalBytes: 1, data: new Uint8Array([1]), ...patch,
    }))
    await expect(icons.load('host', 'icon')).rejects.toThrow('remote_host_icon_invalid')
    icons.dispose()
  }
  const icons = new RemoteHostIcons(async ({ offset }) => create(HostIconSchema, {
    iconId: 'icon', offset, mimeType: 'image/png', totalBytes: offset ? 32769 : 32768, data: new Uint8Array(16384),
  }))
  await expect(icons.load('host', 'icon')).rejects.toThrow('remote_host_icon_invalid')
})

test('队列只占一个请求额度，失败继续处理下一图标，释放后不继续读取', async () => {
  let finish!: () => void
  const blocked = new Promise<void>(resolve => { finish = resolve })
  const read = vi.fn(async ({ iconId }: { iconId: string }) => {
    if (iconId === 'first') { await blocked; throw new Error('network') }
    return create(HostIconSchema, { iconId, mimeType: 'image/svg+xml', totalBytes: 1, data: new Uint8Array([1]) })
  })
  const icons = new RemoteHostIcons(read)
  const first = expect(icons.load('host', 'first')).rejects.toThrow('network')
  const second = icons.load('host', 'second')
  await Promise.resolve()
  expect(read).toHaveBeenCalledTimes(1)
  finish()
  await first
  expect((await second).type).toBe('image/svg+xml')

  let release!: () => void
  const disposed = new RemoteHostIcons(async () => {
    await new Promise<void>(resolve => { release = resolve })
    return create(HostIconSchema, { iconId: 'icon', mimeType: 'image/png', totalBytes: 32768, data: new Uint8Array(16384) })
  })
  const pending = expect(disposed.load('host', 'icon')).rejects.toThrow('remote_disconnected')
  await Promise.resolve()
  disposed.dispose()
  release()
  await pending
})

test('缓存同时限制条目数与字节数，并按最近使用淘汰', async () => {
  for (const size of [1, 5 * 1024 * 1024]) {
    const calls: string[] = []
    const icons = new RemoteHostIcons(async ({ iconId, offset }) => {
      if (!offset) calls.push(iconId)
      return create(HostIconSchema, {
        iconId, offset, mimeType: 'image/png', totalBytes: size, data: new Uint8Array(Math.min(16384, size - offset)),
      })
    })
    const limit = size === 1 ? 256 : 6
    for (let i = 0; i < limit; i++) await icons.load('host', String(i))
    await icons.load('host', '0')
    await icons.load('host', 'next')
    await icons.load('host', '0')
    expect(calls.filter(id => id === '0')).toHaveLength(1)
    await icons.load('host', '1')
    expect(calls.filter(id => id === '1')).toHaveLength(2)
    icons.dispose()
  }
})

test('队列达到上限时返回可补读错误，释放后取消所有排队请求', async () => {
  let release!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve })
  const read = vi.fn(async ({ iconId }: { iconId: string }) => {
    await blocked
    return create(HostIconSchema, { iconId, mimeType: 'image/png', totalBytes: 1, data: new Uint8Array([1]) })
  })
  const icons = new RemoteHostIcons(read)
  const results = Promise.allSettled(Array.from({ length: 256 }, (_, i) => icons.load('host', String(i))))
  await expect(icons.load('host', 'overflow')).rejects.toMatchObject({ code: 'remote_capacity_exceeded' })
  icons.dispose()
  release()
  expect((await results).every(result => result.status === 'rejected')).toBe(true)
  expect(read).toHaveBeenCalledTimes(1)
})
