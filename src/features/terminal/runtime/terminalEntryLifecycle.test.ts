import assert from 'node:assert/strict'
import test from 'node:test'
import { TerminalEntryLifecycle } from './terminalEntryLifecycle.ts'
import type { TerminalEntry } from './terminalRuntimeTypes.ts'

class TrackingEntryMap extends Map<string, TerminalEntry> {
  private readonly events: string[]

  constructor(events: string[]) {
    super()
    this.events = events
  }

  override delete(sessionId: string) {
    this.events.push(`${sessionId}:entries-delete`)
    return super.delete(sessionId)
  }
}

function createEntry(
  sessionId: string,
  events: string[],
  resizeTimer: number | null,
): TerminalEntry {
  return {
    sessionId,
    disposed: false,
    resizeTimer,
    disposables: [
      { dispose: () => events.push(`${sessionId}:subscription-1`) },
      { dispose: () => events.push(`${sessionId}:subscription-2`) },
    ],
    transport: { dispose: () => events.push(`${sessionId}:transport`) },
    terminal: { dispose: () => events.push(`${sessionId}:xterm`) },
    container: { remove: () => events.push(`${sessionId}:dom`) },
  } as unknown as TerminalEntry
}

function createHarness() {
  const events: string[] = []
  const entries = new TrackingEntryMap(events)
  const lifecycle = new TerminalEntryLifecycle({
    getEntries: () => entries,
    applyCwdDisposed: (sessionId) => events.push(`${sessionId}:cwd-disposed`),
    stopCompletionStatusReconciliation: (sessionId) => {
      events.push(`${sessionId}:completion-stop`)
    },
    disposeCompletionSession: (sessionId) => {
      events.push(`${sessionId}:completion-dispose`)
    },
    deleteCompletionLayoutListeners: (sessionId) => {
      events.push(`${sessionId}:listeners-delete`)
    },
    clearResizeTimer: (timer) => {
      const entry = [...entries.values()].find((candidate) => candidate.resizeTimer === timer)
      events.push(`timer-${timer}:clear-after-disposed-${String(entry?.disposed)}`)
    },
  })
  return { entries, events, lifecycle }
}

test('Entry 资源按原顺序释放且重复调用只执行一次', () => {
  const harness = createHarness()
  const entry = createEntry('session-1', harness.events, 17)
  harness.entries.set(entry.sessionId, entry)

  harness.lifecycle.disposeEntry(entry)

  assert.deepEqual(harness.events, [
    'session-1:cwd-disposed',
    'session-1:completion-stop',
    'session-1:completion-dispose',
    'timer-17:clear-after-disposed-true',
    'session-1:subscription-1',
    'session-1:subscription-2',
    'session-1:transport',
    'session-1:xterm',
    'session-1:dom',
    'session-1:entries-delete',
    'session-1:listeners-delete',
  ])
  assert.equal(entry.disposed, true)
  assert.equal(entry.resizeTimer, null)
  assert.equal(harness.entries.has(entry.sessionId), false)

  harness.lifecycle.disposeEntry(entry)
  assert.equal(harness.events.length, 11)
})

test('按会话释放只处理目标，全部释放按当前 Map 快照清理剩余资源', () => {
  const harness = createHarness()
  const first = createEntry('session-1', harness.events, null)
  const second = createEntry('session-2', harness.events, null)
  const third = createEntry('session-3', harness.events, null)
  harness.entries.set(first.sessionId, first)
  harness.entries.set(second.sessionId, second)
  harness.entries.set(third.sessionId, third)

  harness.lifecycle.disposeSession(first.sessionId)
  harness.lifecycle.disposeSession('missing-session')
  assert.equal(first.disposed, true)
  assert.equal(second.disposed, false)
  assert.equal(third.disposed, false)
  assert.deepEqual([...harness.entries.keys()], ['session-2', 'session-3'])

  harness.events.length = 0
  harness.lifecycle.disposeAll()
  assert.equal(second.disposed, true)
  assert.equal(third.disposed, true)
  assert.equal(harness.entries.size, 0)
  assert.deepEqual(
    harness.events.filter((event) => event.endsWith(':cwd-disposed')),
    ['session-2:cwd-disposed', 'session-3:cwd-disposed'],
  )
  assert.deepEqual(
    harness.events.filter((event) => event.endsWith(':entries-delete')),
    ['session-2:entries-delete', 'session-3:entries-delete'],
  )
})
