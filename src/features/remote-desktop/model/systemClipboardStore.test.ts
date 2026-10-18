import assert from 'node:assert/strict'
import test from 'node:test'
import { clearDesktopClipboardSelection, rememberDesktopClipboardSelection, systemClipboardStore } from './systemClipboardStore.ts'

test('观看端换代后旧端释放不清空新端回调，最后解绑停用文件准备入口', async () => {
  const id = 'clipboard-owner-handoff'
  const calls: string[] = []
  const unsubscribe = systemClipboardStore.subscribe(id, () => calls.push('通知'))
  const releaseOld = systemClipboardStore.bind(id, async () => { calls.push('旧端') })
  const releaseNew = systemClipboardStore.bind(id, async () => { calls.push('新端') })
  try {
    releaseOld()
    await systemClipboardStore.prepare(id)
    assert.deepEqual(calls, ['新端'])
    systemClipboardStore.update(id, { busy: true })
    assert.equal(systemClipboardStore.get(id).busy, true)
    releaseNew()
    assert.equal(systemClipboardStore.get(id).busy, false)
    await assert.rejects(systemClipboardStore.prepare(id), /desktop_not_ready/)
    assert.deepEqual(calls, ['新端', '通知', '通知'])
    unsubscribe()
    const releaseNext = systemClipboardStore.bind(id, async () => { calls.push('再次连接') })
    try {
      unsubscribe()
      await systemClipboardStore.prepare(id)
      assert.equal(calls[calls.length - 1], '再次连接')
    } finally { releaseNext() }
  } finally { releaseOld(); releaseNew(); unsubscribe() }
})

test('发送清单仅保留独立元数据快照，不缓存授权路径，最后退订后释放', () => {
  const context = { sessionId: 'outgoing-selection', generation: 1, subscriptionId: 'viewer', controlGeneration: 2 }
  const items = [{ id: 'grant-item', path: 'C:/fixture/资料.txt', name: '资料.txt', kind: 'file', size: 2048 }]
  const unsubscribe = systemClipboardStore.subscribe(context.sessionId, () => {})
  try {
    rememberDesktopClipboardSelection(context, 'prepare-task', items)
    context.controlGeneration = 3
    items[0]!.name = '替换.txt'
    assert.deepEqual(systemClipboardStore.get(context.sessionId).outgoing, {
      context: { ...context, controlGeneration: 2 }, taskId: 'prepare-task', items: [{ name: '资料.txt', kind: 'file', size: 2048 }],
    })
  } finally { unsubscribe() }
  assert.equal(systemClipboardStore.get(context.sessionId).outgoing, undefined)
})

test('旧撤销操作只清理原快照，不覆盖后续任务的发送清单', () => {
  const context = { sessionId: 'outgoing-revoke', generation: 1, subscriptionId: 'viewer', controlGeneration: 2 }
  const unsubscribe = systemClipboardStore.subscribe(context.sessionId, () => {})
  try {
    rememberDesktopClipboardSelection(context, 'first-task', [{ name: '原文件.txt', kind: 'file' }])
    const first = systemClipboardStore.get(context.sessionId).outgoing!
    rememberDesktopClipboardSelection(context, 'next-task', [{ name: '新文件.txt', kind: 'file' }])
    clearDesktopClipboardSelection(first)
    const next = systemClipboardStore.get(context.sessionId).outgoing!
    assert.equal(next.taskId, 'next-task')
    clearDesktopClipboardSelection(next)
    assert.equal(systemClipboardStore.get(context.sessionId).outgoing, undefined)
  } finally { unsubscribe() }
})
