import assert from 'node:assert/strict'
import test from 'node:test'
import { RemoteCore } from './core.ts'
import { RemotePolicyEditorSession } from './policyEditor.ts'

test('原生目录句柄绑定窗口和编辑会话，关闭后不能派发写入', async () => {
  const calls: unknown[] = []
  const core = new RemoteCore(async () => { throw new Error('禁止访问真实配置') })
  core.request = async <T,>(path: string, body?: unknown): Promise<T> => { calls.push({ path, body }); return {} as T }
  const editor = new RemotePolicyEditorSession(core)
  await editor.open(1, 'account', 'first')
  let resolve!: (path: string) => void
  const selecting = editor.select(1, 'account', 'first', () => new Promise<string>(done => { resolve = done }))
  editor.close(1, 'first'); resolve('D:\\fixture')
  await assert.rejects(selecting, /remote_editor_closed/)
  await editor.open(1, 'account', 'second')
  const selection = await editor.select(1, 'account', 'second', async () => 'D:\\fixture')
  await assert.rejects(editor.change(2, 'account', 'second', 0, { kind: 'directory_add', selection, write: true }), /remote_editor_closed/)
  await assert.rejects(editor.change(1, 'account', 'second', 0, { kind: 'directory_add', path: 'D:\\other', write: true }), /remote_invalid_request/)
  await editor.change(1, 'account', 'second', 0, { kind: 'directory_add', selection, write: true })
  assert.deepEqual(calls[calls.length - 1], { path: '/remote-control/policy', body: { generation: 'account', revision: 0, change: { kind: 'directory_add', path: 'D:\\fixture', write: true } } })
  await assert.rejects(editor.change(1, 'account', 'second', 0, { kind: 'directory_add', selection, write: true }), /remote_invalid_request/)
  assert.equal(calls.length, 3)
})
