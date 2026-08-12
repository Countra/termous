import assert from 'node:assert/strict'
import test from 'node:test'
import type { CommandDispatchOutputSnapshot } from './commandDispatchOutputStore.ts'
import {
  CommandDispatchOutputWriter,
  type CommandDispatchOutputTerminal,
} from './commandDispatchOutputWriter.ts'

test('xterm 前一批字节解析完成后才执行 revision 跳跃的完整重放', () => {
  const terminal = new DeferredTerminal()
  const writer = new CommandDispatchOutputWriter(terminal)

  writer.update(snapshot(1, [0x61]))
  writer.update(snapshot(3, [0x61, 0x62, 0x63]))

  assert.deepEqual(terminal.operations, ['reset', 'write:a'])
  terminal.completeWrite()
  assert.deepEqual(terminal.operations, [
    'reset',
    'write:a',
    'scroll',
    'reset',
    'write:abc',
  ])
  terminal.completeWrite()
  assert.equal(terminal.operations[terminal.operations.length - 1], 'scroll')
})

test('写入积压期间合并到最新快照而不逐项重复追加', () => {
  const terminal = new DeferredTerminal()
  const writer = new CommandDispatchOutputWriter(terminal)

  writer.update(snapshot(1, [0x61]))
  writer.update(snapshot(2, [0x61, 0x62]))
  writer.update(snapshot(3, [0x61, 0x62, 0x63]))
  terminal.completeWrite()

  assert.deepEqual(terminal.operations, [
    'reset',
    'write:a',
    'scroll',
    'reset',
    'write:abc',
  ])
})

class DeferredTerminal implements CommandDispatchOutputTerminal {
  readonly operations: string[] = []
  private callbacks: Array<() => void> = []

  reset() {
    this.operations.push('reset')
  }

  scrollToBottom() {
    this.operations.push('scroll')
  }

  write(data: Uint8Array, callback: () => void) {
    this.operations.push(`write:${new TextDecoder().decode(data)}`)
    this.callbacks.push(callback)
  }

  completeWrite() {
    const callback = this.callbacks.shift()
    assert.ok(callback)
    callback()
  }
}

function snapshot(revision: number, bytes: number[]): CommandDispatchOutputSnapshot {
  return {
    taskId: 'task-1',
    sessionId: 'session-1',
    revision,
    data: Uint8Array.from(bytes),
    chunk: Uint8Array.from(bytes),
    resetRevision: 0,
    connected: true,
    ended: false,
    truncated: false,
  }
}
