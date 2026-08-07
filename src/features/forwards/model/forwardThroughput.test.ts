import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FORWARD_THROUGHPUT_IDLE_MS,
  FORWARD_THROUGHPUT_PUBLISH_MS,
  ForwardThroughputSampler,
  mapForwardTraffic,
  resolveForwardThroughputNextWakeAt,
  resolveForwardThroughputPublishAt,
} from './forwardThroughput.ts'

test('实时速度使用固定一秒发布节拍且空闲后重新建立节拍', () => {
  assert.equal(FORWARD_THROUGHPUT_PUBLISH_MS, 1_000)
  assert.equal(resolveForwardThroughputPublishAt(250, 1_000, false), 1_000)
  assert.equal(resolveForwardThroughputPublishAt(10_250, 1_000, false), 11_250)
  assert.equal(resolveForwardThroughputPublishAt(10_250, 11_000, true), 11_000)
})

test('空闲归零按真实截止时间唤醒，不等待下一秒发布节拍', () => {
  assert.equal(resolveForwardThroughputNextWakeAt(1_000, 2_000, false, 1_251), 1_251)
  assert.equal(resolveForwardThroughputNextWakeAt(1_251, 2_000, true, 2_350), 2_000)
  assert.equal(resolveForwardThroughputNextWakeAt(1_251, 2_000, false, null), null)
})

test('发送和接收累计量及速度保持相同方向映射', () => {
  assert.deepEqual(
    mapForwardTraffic(120, 340, {
      bytesInPerSecond: 12,
      bytesOutPerSecond: 34,
      receiving: true,
      sending: true,
    }),
    {
      sentTotal: 340,
      sentPerSecond: 34,
      receivedTotal: 120,
      receivedPerSecond: 12,
    },
  )
})

test('首次快照只建立基线且连续样本分别计算双向速度', () => {
  const sampler = new ForwardThroughputSampler()
  assert.deepEqual(observe(sampler, 0, 0, 0), emptyThroughput())

  const throughput = observe(sampler, 250, 500, 1_000)
  assert.equal(throughput.bytesInPerSecond, 2_000)
  assert.equal(throughput.bytesOutPerSecond, 4_000)
  assert.equal(throughput.receiving, true)
  assert.equal(throughput.sending, true)
})

test('滚动窗口按累计差值吸收不规则间隔和丢失的中间事件', () => {
  const sampler = new ForwardThroughputSampler()
  observe(sampler, 0, 0, 0)
  observe(sampler, 300, 300, 150)
  const throughput = observe(sampler, 900, 900, 600)

  assert.equal(throughput.bytesInPerSecond, 1_000)
  assert.equal(throughput.bytesOutPerSecond, 600 / 0.9)
})

test('两个方向按各自最后活动时间独立归零', () => {
  const sampler = new ForwardThroughputSampler()
  observe(sampler, 0, 0, 0)
  observe(sampler, 250, 250, 250)
  observe(sampler, 500, 250, 500)

  const beforeReceiveExpiry = sampler.expire(250 + FORWARD_THROUGHPUT_IDLE_MS - 1)
  assert.equal(beforeReceiveExpiry.bytesInPerSecond, 1_000)
  assert.equal(beforeReceiveExpiry.receiving, true)

  const receiveExpired = sampler.expire(250 + FORWARD_THROUGHPUT_IDLE_MS)
  assert.equal(receiveExpired.bytesInPerSecond, 0)
  assert.equal(receiveExpired.receiving, false)
  assert.equal(receiveExpired.bytesOutPerSecond, 1_000)
  assert.equal(receiveExpired.sending, true)

  assert.deepEqual(sampler.expire(500 + FORWARD_THROUGHPUT_IDLE_MS), emptyThroughput())
  assert.equal(sampler.nextExpiryAt(), null)
})

test('计数回退进入高水位恢复且不会产生虚假峰值', () => {
  const sampler = new ForwardThroughputSampler()
  observe(sampler, 0, 0, 0)
  assert.equal(observe(sampler, 250, 250, 250).bytesOutPerSecond, 1_000)

  assert.deepEqual(observe(sampler, 500, 100, 100), emptyThroughput())
  assert.deepEqual(observe(sampler, 750, 200, 300), emptyThroughput())
  const outputRecovered = observe(sampler, 1_000, 250, 350)
  assert.equal(outputRecovered.bytesInPerSecond, 0)
  assert.equal(outputRecovered.bytesOutPerSecond, 200)
  const recovered = observe(sampler, 1_250, 500, 600)
  assert.equal(recovered.bytesInPerSecond, 1_000)
  assert.equal(recovered.bytesOutPerSecond, 600)
})

test('两个方向独立处理计数回退和高水位恢复', () => {
  const sampler = new ForwardThroughputSampler()
  observe(sampler, 0, 1_000, 1_000)
  observe(sampler, 250, 1_250, 1_250)

  const regressed = observe(sampler, 500, 1_100, 1_500)
  assert.equal(regressed.bytesInPerSecond, 0)
  assert.equal(regressed.bytesOutPerSecond, 1_000)

  const outputContinues = observe(sampler, 750, 1_100, 1_750)
  assert.equal(outputContinues.bytesInPerSecond, 0)
  assert.equal(outputContinues.bytesOutPerSecond, 1_000)

  assert.equal(observe(sampler, 1_000, 1_250, 2_000).bytesInPerSecond, 0)
  const inputRecovered = observe(sampler, 1_250, 1_500, 2_250)
  assert.equal(inputRecovered.bytesInPerSecond, 1_000)
  assert.equal(inputRecovered.bytesOutPerSecond, 1_000)
})

test('转发标识、启动时间和运行状态变化都会重新建立基线', () => {
  const sampler = new ForwardThroughputSampler()
  observe(sampler, 0, 0, 0)
  assert.equal(observe(sampler, 250, 250, 250).bytesOutPerSecond, 1_000)

  assert.deepEqual(observe(sampler, 500, 500, 500, { forwardId: 'forward-2' }), emptyThroughput())
  assert.deepEqual(observe(sampler, 750, 750, 750, {
    forwardId: 'forward-2',
    startedAt: '2026-07-28T10:00:00Z',
  }), emptyThroughput())
  assert.deepEqual(observe(sampler, 1_000, 1_000, 1_000, {
    forwardId: 'forward-2',
    startedAt: '2026-07-28T10:00:00Z',
    running: false,
  }), emptyThroughput())
})

test('过短采样间隔和无效计数不会生成异常速度', () => {
  const sampler = new ForwardThroughputSampler()
  observe(sampler, 0, 0, 0)
  assert.deepEqual(observe(sampler, 20, 1_000_000, 1_000_000), emptyThroughput())

  const invalid = observe(sampler, 250, Number.NaN, Number.POSITIVE_INFINITY)
  assert.deepEqual(invalid, emptyThroughput())
  assert.equal(Number.isFinite(invalid.bytesInPerSecond), true)
  assert.equal(Number.isFinite(invalid.bytesOutPerSecond), true)
})

test('时钟回退只重新建立基线', () => {
  const sampler = new ForwardThroughputSampler()
  observe(sampler, 1_000, 0, 0)
  assert.equal(observe(sampler, 1_250, 250, 250).bytesOutPerSecond, 1_000)
  assert.deepEqual(observe(sampler, 500, 500, 500), emptyThroughput())
})

test('超过采样窗口后的累计跳变只作为新基线', () => {
  const sampler = new ForwardThroughputSampler()
  observe(sampler, 0, 0, 0)
  assert.equal(observe(sampler, 250, 250, 250).bytesOutPerSecond, 1_000)
  assert.deepEqual(observe(sampler, 1_500, 10_000, 10_000), emptyThroughput())
  assert.equal(observe(sampler, 1_750, 10_250, 10_250).bytesOutPerSecond, 1_000)
})

test('一秒滚动窗口排除窗口外的历史流量', () => {
  const sampler = new ForwardThroughputSampler()
  observe(sampler, 0, 0, 0)
  observe(sampler, 600, 600, 600)
  const throughput = observe(sampler, 1_200, 900, 900)

  assert.equal(throughput.bytesInPerSecond, 700)
  assert.equal(throughput.bytesOutPerSecond, 700)
})

function observe(
  sampler: ForwardThroughputSampler,
  at: number,
  bytesIn: number,
  bytesOut: number,
  options: { forwardId?: string; startedAt?: string; running?: boolean } = {},
) {
  return sampler.observe({
    forwardId: options.forwardId ?? 'forward-1',
    startedAt: options.startedAt,
    running: options.running ?? true,
    bytesIn,
    bytesOut,
    at,
  })
}

function emptyThroughput() {
  return {
    bytesInPerSecond: 0,
    bytesOutPerSecond: 0,
    receiving: false,
    sending: false,
  }
}
