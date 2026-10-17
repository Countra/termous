import assert from 'node:assert/strict'
import test from 'node:test'
import { systemClipboardStore } from './systemClipboardStore.ts'

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
