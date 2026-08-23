import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  FileSession,
} from '#entities/file'
import type { ForwardInstance } from '#entities/forward'
import type { Session } from '#entities/session'
import { buildUpdateRuntimeSummary } from '../app/update-runtime/updateRuntimeSummary.ts'

test('更新安装影响摘要统计仍会被退出流程中断的远程资源', () => {
  const sessions = [
    { kind: 'ssh', status: 'connecting' },
    { kind: 'ssh', status: 'waiting_host_trust' },
    { kind: 'ssh', status: 'connected' },
    { kind: 'ssh', status: 'failed' },
    { kind: 'local', status: 'connected' },
  ] as Session[]
  const fileSessions = [
    { status: 'connecting' },
    { status: 'connected' },
    { status: 'waiting_trust' },
    { status: 'disconnected' },
  ] as FileSession[]
  const forwards = [
    { status: 'starting' },
    { status: 'waiting_host_trust' },
    { status: 'running' },
    { status: 'reconnecting' },
    { status: 'stopping' },
  ] as ForwardInstance[]

  assert.deepEqual(buildUpdateRuntimeSummary({
    activeTransferCount: 4,
    fileSessions,
    forwards,
    sessions,
    transferSnapshotComplete: true,
  }), {
    ssh_sessions: 3,
    file_sessions: 3,
    forwards: 5,
    transfers: 4,
    transfers_complete: true,
  })
})

test('更新安装影响摘要限制异常的传输数量', () => {
  const summary = buildUpdateRuntimeSummary({
    activeTransferCount: Number.POSITIVE_INFINITY,
    fileSessions: [],
    forwards: [],
    sessions: [],
    transferSnapshotComplete: false,
  })
  assert.equal(summary.transfers, 0)
  assert.equal(summary.transfers_complete, false)
})
