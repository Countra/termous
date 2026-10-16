import assert from 'node:assert/strict'
import { WebSocket } from 'ws'

// 全局领取接口没有按 Run 隔离的参数；验收只允许在没有其他任务的开发 Core 上运行。
// 快照检查不能阻止检查后新增任务，运行期间仍需保持该 Core 专用于验收。
export async function assertGuidanceCoreIdle(coreURL, ownRunID) {
  const socket = new WebSocket(`${coreURL.replace('http:', 'ws:')}/api/v1/agent/events`, {
    headers: { 'X-Termous-Token': 'dev-token' }, handshakeTimeout: 10000,
  })
  try {
    const snapshot = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('开发 Core 工作区快照超时')), 10000)
      socket.once('error', reject)
      socket.once('close', () => { clearTimeout(timer); reject(new Error('开发 Core 工作区通道已关闭')) })
      socket.once('message', (message) => {
        clearTimeout(timer)
        try { resolve(JSON.parse(String(message))) } catch (error) { reject(error) }
      })
    })
    assert.equal(snapshot.type, 'snapshot', '必须取得权威工作区快照')
    assert.ok(Array.isArray(snapshot.active_runs) && Array.isArray(snapshot.queued_turns), '工作区快照缺少调度状态')
    assert.ok(snapshot.active_runs.every((run) => ownRunID && run.id === ownRunID)
      && snapshot.queued_turns.length === 0, '开发 Core 存在其他活动或排队任务，不能进行全局领取验收')
  } finally { socket.terminate() }
}

export function guidanceHeartbeat(register) {
  let pending, failure
  const timer = setInterval(() => {
    if (pending || failure) return
    pending = register().catch((error) => { failure = error }).finally(() => { pending = undefined })
  }, 10000)
  return {
    check() { if (failure) throw new Error('验收宿主心跳失效', { cause: failure }) },
    // 注销前等最后一次在途心跳完成，避免已注销的宿主被迟到请求重新注册。
    async stop() { clearInterval(timer); await pending },
  }
}
