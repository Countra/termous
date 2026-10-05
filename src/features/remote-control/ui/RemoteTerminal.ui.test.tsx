import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { create } from '@bufbuild/protobuf'
import { ResponseSchema, SessionSchema, StreamFrameSchema, type Response, type StreamFrame } from '@termous/remote-protocol'
import { expect, test, vi } from 'vitest'
import { RemoteClient } from '#entities/remote-control'
import type { RemoteConnection } from '#common/contracts'
import { remoteCopy } from '../model/copy'
import { RemoteTerminal } from './RemoteTerminal'

const rendering = vi.hoisted(() => ({ pending: [] as (() => void)[], hold: false }))
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    options = {}
    parser = { registerOscHandler: () => ({ dispose() {} }) }
    loadAddon() {}
    open() {}
    onData() { return { dispose() {} } }
    write(_data: Uint8Array, done: () => void) { if (rendering.hold) rendering.pending.push(done); else done() }
    dispose() {}
  },
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }))

test('关闭终端后迟到的输入授权按原代次回收', async () => {
  let resolveAcquisition!: (value: Response) => void
  const acquisition = new Promise<Response>(resolve => { resolveAcquisition = resolve })
  const connection = { scope: { controller_id: 'phone' } } as RemoteConnection
  const client = new RemoteClient({} as ConstructorParameters<typeof RemoteClient>[0], connection)
  const request = vi.spyOn(client, 'request').mockImplementation(async input => {
    const action = input.operation?.case === 'session' ? input.operation.value.action : ''
    if (action === 'attach') return create(ResponseSchema, { result: { case: 'attachment', value: { streamId: 'stream' } } })
    if (action === 'control_acquire') return acquisition
    return create(ResponseSchema)
  })
  vi.spyOn(client, 'send').mockResolvedValue()
  const copy = remoteCopy('zh-CN')
  const view = render(<RemoteTerminal client={client} session={create(SessionSchema, { id: 'session', generation: 1n })} copy={copy} theme="dark" />)
  await waitFor(() => expect(request).toHaveBeenCalledWith(expect.objectContaining({ operation: expect.objectContaining({ value: expect.objectContaining({ action: 'control_status' }) }) })))
  fireEvent.click(screen.getByRole('button', { name: copy.takeControl }))
  view.unmount()
  await act(async () => { resolveAcquisition(create(ResponseSchema, { result: { case: 'control', value: { ownerDeviceId: 'phone', generation: 9n } } })) })
  expect(request).toHaveBeenCalledWith({ operation: { case: 'session', value: { sessionId: 'session', generation: 1n, action: 'control_release', controlGeneration: 9n } } })
  expect(request.mock.calls.some(([input]) => input.operation?.case === 'session' && input.operation.value.action === 'resize')).toBe(false)
})

for (const blocked of ['render', 'credit'] as const) {
  test(`切换终端时不被未完成的 ${blocked} 阻塞消息回执`, async () => {
    rendering.hold = blocked === 'render'
    rendering.pending = []
    let receive!: (frame: StreamFrame) => void | Promise<void>
    let finishCredit!: () => void
    const client = new RemoteClient({} as ConstructorParameters<typeof RemoteClient>[0], { scope: { controller_id: 'phone' } } as RemoteConnection)
    vi.spyOn(client, 'request').mockImplementation(async input => create(ResponseSchema, input.operation?.case === 'session' && input.operation.value.action === 'attach' ? { result: { case: 'attachment', value: { streamId: 'stream' } } } : {}))
    const send = vi.spyOn(client, 'send').mockResolvedValue()
    vi.spyOn(client, 'stream').mockImplementation((_id, callback) => { receive = callback; return () => {} })
    const view = render(<RemoteTerminal client={client} session={create(SessionSchema, { id: 'session', generation: 1n })} copy={remoteCopy('zh-CN')} theme="dark" />)
    await waitFor(() => expect(receive).toBeDefined())
    send.mockImplementation(() => new Promise<void>(resolve => { finishCredit = resolve }))
    let acknowledged = false
    await act(async () => {
      void Promise.resolve(receive(create(StreamFrameSchema, { kind: 'terminal_output', sequence: 1n, data: Uint8Array.of(65) }))).then(() => { acknowledged = true })
    })
    if (blocked === 'render') view.unmount()
    try { await waitFor(() => expect(acknowledged).toBe(true)) }
    finally {
      view.unmount()
      await act(async () => { rendering.pending.forEach(done => done()); finishCredit?.() })
      rendering.hold = false
    }
  })
}
