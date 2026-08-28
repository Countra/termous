import assert from 'node:assert/strict'
import test from 'node:test'
import { agentRuntimeProtocolVersion } from '#common/contracts'
import type { AgentWorkerStartMessage } from './protocol.ts'
import { RuntimeEventWriter } from './runtimeEventWriter.ts'
import { testAgentSkillBundle } from './skillBundleTestFixture.ts'
import type {
  RuntimeEventInput,
  WorkerCoreClientPort,
} from './workerCoreClient.ts'

const start: AgentWorkerStartMessage = {
  type: 'start',
  protocol_version: agentRuntimeProtocolVersion,
  core_base_url: 'http://127.0.0.1:52000',
  ticket: 't'.repeat(48),
  run_id: 'agr_test',
  generation: 2,
  skills: testAgentSkillBundle(),
}

class RecordingCore implements WorkerCoreClientPort {
  readonly batches: RuntimeEventInput[][] = []
  readonly order: string[] = []

  bootstrap(): Promise<never> {
    throw new Error('not implemented')
  }

  async appendEvents(
    runtimeStart: AgentWorkerStartMessage,
    runtimeBearer: string,
    events: RuntimeEventInput[],
  ) {
    void runtimeStart
    void runtimeBearer
    this.batches.push(events)
    const last = events[events.length - 1]
    this.order.push(`events:${events[0]?.sequence}-${last?.sequence}`)
    return last?.sequence ?? 0
  }

  appendSteer(): Promise<number> {
    throw new Error('not implemented')
  }
}

test('Runtime Event Writer 以 64 条分批并保持单调 sequence', async () => {
  const core = new RecordingCore()
  const writer = new RuntimeEventWriter({
    core,
    start,
    runtimeBearer: 'r'.repeat(48),
    initialSequence: 5,
    onFailure: (error) => assert.fail(String(error)),
    flushDelayMs: 60_000,
    newEventID: (() => {
      let current = 0
      return () => `age_test_${++current}`
    })(),
  })
  for (let index = 0; index < 65; index++) {
    writer.push('usage', {
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        reasoning_tokens: 0,
        total_tokens: 0,
        estimated: true,
      },
    })
  }
  await writer.flush()

  assert.deepEqual(core.batches.map((batch) => batch.length), [64, 1])
  assert.equal(core.batches[0]?.[0]?.sequence, 6)
  assert.equal(core.batches[1]?.[0]?.sequence, 70)
})

test('外部 steer 写入与普通事件共享同一串行 sequence', async () => {
  const core = new RecordingCore()
  const writer = new RuntimeEventWriter({
    core,
    start,
    runtimeBearer: 'r'.repeat(48),
    initialSequence: 10,
    onFailure: (error) => assert.fail(String(error)),
    flushDelayMs: 60_000,
    newEventID: () => 'age_external',
  })
  writer.push('status', { status: { status: 'running' } })
  const external = writer.writeExternal(async (eventID, sequence) => {
    core.order.push(`steer:${sequence}:${eventID}`)
    return { lastSequence: sequence, value: 'stored' }
  })
  writer.push('usage', {
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      reasoning_tokens: 0,
      total_tokens: 2,
      estimated: false,
    },
  })

  assert.equal(await external, 'stored')
  await writer.flush()
  assert.deepEqual(core.order, [
    'events:11-11',
    'steer:12:age_external',
    'events:13-13',
  ])
})

test('Runtime Event Writer 按请求字节预算拆分多个大事件', async () => {
  const core = new RecordingCore()
  const writer = new RuntimeEventWriter({
    core,
    start,
    runtimeBearer: 'r'.repeat(48),
    initialSequence: 0,
    onFailure: (error) => assert.fail(String(error)),
    flushDelayMs: 60_000,
  })
  for (let index = 0; index < 4; index++) {
    writer.push('message_delta', {
      message_delta: {
        message_id: 'agm_reply',
        part_id: 'agp_reply',
        delta: 'x'.repeat(230 * 1024),
      },
    })
  }
  await writer.flush()

  assert.deepEqual(core.batches.map((batch) => batch.length), [3, 1])
  assert.deepEqual(core.batches.flat().map((event) => event.sequence), [1, 2, 3, 4])
})

test('Runtime Event Writer 拒绝单个超预算事件且不消耗 sequence', async () => {
  const core = new RecordingCore()
  const writer = new RuntimeEventWriter({
    core,
    start,
    runtimeBearer: 'r'.repeat(48),
    initialSequence: 7,
    onFailure: (error) => assert.fail(String(error)),
    flushDelayMs: 60_000,
  })

  assert.throws(() => writer.push('message_delta', {
    message_delta: {
      message_id: 'agm_reply',
      part_id: 'agp_reply',
      delta: 'x'.repeat(769 * 1024),
    },
  }), /AGENT_RUNTIME_EVENT_TOO_LARGE/)
  writer.push('status', { status: { status: 'running' } })
  await writer.flush()

  assert.equal(core.batches[0]?.[0]?.sequence, 8)
})

test('回写失败只通知一次并使 Writer 永久失败', async () => {
  let failures = 0
  const core = new RecordingCore()
  core.appendEvents = async () => {
    throw new Error('write failed')
  }
  const writer = new RuntimeEventWriter({
    core,
    start,
    runtimeBearer: 'r'.repeat(48),
    initialSequence: 1,
    onFailure: () => failures++,
    flushDelayMs: 60_000,
  })
  writer.push('status', { status: { status: 'running' } })
  await assert.rejects(writer.flush(), /write failed/)
  assert.throws(() => writer.push('status', { status: { status: 'failed' } }), /write failed/)
  assert.equal(failures, 1)
})

test('首个批次失败后不再发送已排队批次或外部写入', async () => {
  let eventCalls = 0
  let externalCalls = 0
  const core = new RecordingCore()
  core.appendEvents = async () => {
    eventCalls++
    throw new Error('write failed')
  }
  const writer = new RuntimeEventWriter({
    core,
    start,
    runtimeBearer: 'r'.repeat(48),
    initialSequence: 0,
    onFailure: () => undefined,
    flushDelayMs: 60_000,
  })
  for (let index = 0; index < 65; index++) {
    writer.push('message_delta', { delta: String(index) })
  }

  await assert.rejects(
    writer.writeExternal(async (_eventID, sequence) => {
      externalCalls++
      return { lastSequence: sequence, value: undefined }
    }),
    /write failed/,
  )
  assert.equal(eventCalls, 1)
  assert.equal(externalCalls, 0)
})
