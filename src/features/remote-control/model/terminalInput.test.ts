import assert from 'node:assert/strict'
import test from 'node:test'
import { TerminalInput } from './terminalInput.ts'

test('输入确认后才继续发送，旧代次不能确认新输入', async () => {
  const sent: { data: number[]; generation: bigint; sequence: bigint }[] = []
  const input = new TerminalInput(async (data, generation, sequence) => { sent.push({ data: [...data], generation, sequence }) }, () => undefined)
  input.update(3n, 0n, true)
  input.push(Uint8Array.of(1)); input.push(Uint8Array.of(2))
  assert.equal(sent.length, 1)
  input.acknowledge(2n, 1n)
  assert.equal(sent.length, 1)
  input.acknowledge(3n, 1n)
  assert.deepEqual(sent.map(value => value.sequence), [1n, 2n])
  input.dispose()
})

test('结果不明的输入不重放，重读确认后丢弃旧队列', () => {
  const sent: number[] = []
  const input = new TerminalInput(async data => { sent.push(...data) }, () => undefined)
  input.update(1n, 0n, true)
  input.push(Uint8Array.of(1)); input.push(Uint8Array.of(2))
  input.freeze()
  input.update(1n, 0n, true)
  input.push(Uint8Array.of(3))
  assert.deepEqual(sent, [1])
  input.update(1n, 1n, true)
  input.push(Uint8Array.of(4))
  assert.deepEqual(sent, [1, 4])
  input.dispose()
})

for (const transition of ['generation', 'acknowledged', 'disposed'] as const) {
  test(`迟到的发送失败不能影响已${transition}的输入`, async () => {
    let reject!: (reason: Error) => void
    let writes = 0
    const changes: boolean[] = []
    const input = new TerminalInput(() => {
      writes++
      return writes === 1 ? new Promise<void>((_, fail) => { reject = fail }) : Promise.resolve()
    }, frozen => changes.push(frozen))
    input.update(1n, 0n, true)
    input.push(Uint8Array.of(1))
    if (transition === 'generation') input.update(2n, 0n, true)
    else if (transition === 'acknowledged') input.acknowledge(1n, 1n)
    else input.dispose()
    if (transition !== 'disposed') input.push(Uint8Array.of(2))
    const count = changes.length
    reject(new Error('旧发送失败'))
    await Promise.resolve()
    assert.equal(changes.length, count)
    assert.equal(changes.includes(true), false)
    input.dispose()
  })
}
