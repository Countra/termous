import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { create } from '@bufbuild/protobuf'
import { ResponseSchema, SessionSchema, type Response } from '@termous/remote-protocol'
import { expect, test, vi } from 'vitest'
import { RemoteClient } from '#entities/remote-control'
import type { RemoteConnection } from '#common/contracts'
import { remoteCopy } from '../model/copy'
import { RemoteTerminal } from './RemoteTerminal'

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    options = {}
    parser = { registerOscHandler: () => ({ dispose() {} }) }
    loadAddon() {}
    open() {}
    onData() { return { dispose() {} } }
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
