import assert from 'node:assert/strict'
import test from 'node:test'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { skillInstallIPCChannels } from '#common/contracts'
import { registerSkillInstallIPC } from './ipc.ts'

test('安装 IPC 校验窗口及参数，目录取消不写入，计划归属由可信窗口填充', async () => {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, request: unknown) => Promise<unknown>>()
  const event = { sender: { id: 42 } } as IpcMainInvokeEvent
  let trusted = false
  let directory: string | null = null
  const calls: unknown[][] = []
  const dispose = registerSkillInstallIPC({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler as never), removeHandler: (channel) => handlers.delete(channel) } as Pick<IpcMain, 'handle' | 'removeHandler'>,
    installer: {
      prepare: async (...args) => { calls.push(args); return { id: 'plan', client: 'custom', base_directory: 'base', target_directory: 'base', skills: [] } },
      install: async (...args) => { calls.push(args); return { target_directory: 'base', items: [] } },
    },
    isTrustedSender: () => trusted,
    pickDirectory: async () => directory,
  })
  const select = handlers.get(skillInstallIPCChannels.selectDirectory)!
  const install = handlers.get(skillInstallIPCChannels.install)!
  await assert.rejects(select(event, 'codex'), /IPC_NOT_ALLOWED/)
  await assert.rejects(install(event, { plan_id: 'plan', policy: 'skip' }), /IPC_NOT_ALLOWED/)
  trusted = true
  assert.deepEqual(await select(event, 'unknown'), { ok: false, error: 'invalid_request' })
  assert.deepEqual(await select(event, 'custom'), { ok: true, value: null })
  assert.deepEqual(calls, [])
  directory = 'chosen-by-native-dialog'
  await select(event, 'custom')
  assert.deepEqual(calls[0], [directory, 'custom', 42])
  for (const request of [null, [], {}, { plan_id: 'plan', policy: 'other' }, { plan_id: 'plan', policy: 'skip', path: '/injected' }]) {
    assert.deepEqual(await install(event, request), { ok: false, error: 'invalid_request' })
  }
  await install(event, { plan_id: 'plan', policy: 'replace' })
  assert.deepEqual(calls[1], ['plan', 'replace', 42])
  dispose()
  assert.equal(handlers.size, 0)
})
