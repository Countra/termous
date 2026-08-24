import { expect, test, vi } from 'vitest'
import { emptyVncConnectionMetrics } from '../model/viewerTypes.ts'
import { VncConnectionMetricsStore } from './vncConnectionMetricsStore.tsx'

test('连接指标按会话隔离发布并支持重置', () => {
  const store = new VncConnectionMetricsStore()
  const firstListener = vi.fn()
  const secondListener = vi.fn()
  const unsubscribeFirst = store.subscribe('rds_first', firstListener)
  store.subscribe('rds_second', secondListener)
  const metrics = { ...emptyVncConnectionMetrics, sampledAt: 10, receivedBytes: 2048 }

  store.activateGeneration('rds_first', 1)
  store.publish('rds_first', 1, metrics)
  expect(store.snapshot('rds_first')).toEqual(metrics)
  expect(store.snapshot('rds_second')).toBe(emptyVncConnectionMetrics)
  expect(firstListener).toHaveBeenCalledTimes(1)
  expect(secondListener).not.toHaveBeenCalled()

  store.reset('rds_first')
  expect(store.snapshot('rds_first')).toBe(emptyVncConnectionMetrics)
  expect(firstListener).toHaveBeenCalledTimes(2)
  unsubscribeFirst()
})

test('VNC 传输采样与 SSH 延迟按 generation 合并且拒绝迟到数据', () => {
  const store = new VncConnectionMetricsStore()
  store.activateGeneration('rds_test', 1)
  store.publishSshRtt('rds_test', 1, 22.4, 1_000)
  store.publish('rds_test', 1, {
    connectedAt: 900,
    sampledAt: 1_100,
    receivedBytes: 4096,
    sentBytes: 64,
    receiveBytesPerSecond: 1024,
    sendBytesPerSecond: 16,
    bufferedAmount: 0,
    outboundMeasured: true,
  })

  expect(store.snapshot('rds_test')).toMatchObject({
    sshRttMs: 22.4,
    sshRttSampledAt: 1_000,
    receivedBytes: 4096,
  })

  store.activateGeneration('rds_test', 2)
  store.publishSshRtt('rds_test', 1, 99, 2_000)
  store.publish('rds_test', 1, {
    connectedAt: 900,
    sampledAt: 2_000,
    receivedBytes: 8192,
    sentBytes: 128,
    receiveBytesPerSecond: 2048,
    sendBytesPerSecond: 32,
    bufferedAmount: 0,
    outboundMeasured: true,
  })
  expect(store.snapshot('rds_test')).toBe(emptyVncConnectionMetrics)

  store.publishSshRtt('rds_test', 2, 18, 3_000)
  store.publishSshRtt('rds_test', 2, 45, 2_500)
  expect(store.snapshot('rds_test')).toMatchObject({ sshRttMs: 18, sshRttSampledAt: 3_000 })
})
