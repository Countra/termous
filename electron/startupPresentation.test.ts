import assert from 'node:assert/strict'
import test from 'node:test'
import type { CoreStartupSnapshot } from '#common/contracts'
import { StartupPresentation } from './startupPresentation.ts'

function fixture() {
  let now = 0
  let nextTimer = 0
  let revision = 0
  const timers = new Map<number, { at: number; callback: () => void }>()
  const presentation = new StartupPresentation({
    now: () => now,
    setTimer: (callback, delayMs) => {
      const id = ++nextTimer
      timers.set(id, { at: now + delayMs, callback })
      return id
    },
    clearTimer: (handle) => { timers.delete(handle as number) },
    onChange: () => undefined,
  })
  const update = (patch: Partial<CoreStartupSnapshot> = {}) => {
    const snapshot: CoreStartupSnapshot = {
      attemptId: 'attempt-1', instanceId: 'core-1', revision: ++revision,
      phase: 'database', failure: null, attention: null,
      startedAt: '2026-09-07T00:00:00Z', updatedAt: '2026-09-07T00:00:00Z',
      database: { status: 'completed', operation: 'upgrade', fromVersion: 25, targetVersion: 37 },
      ...patch,
    }
    presentation.update(snapshot)
    return snapshot
  }
  const advance = (duration: number) => {
    const target = now + duration
    while (true) {
      const entry = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0]
      if (!entry || entry[1].at > target) break
      now = entry[1].at
      timers.delete(entry[0])
      entry[1].callback()
    }
    now = target
  }
  const acknowledge = () => presentation.presented(presentation.getView())
  return { presentation, update, advance, acknowledge, timers }
}

test('极快升级等待真实显示确认，按 600ms 和 500ms 展示后完成启动', () => {
  const { presentation, update, advance, acknowledge } = fixture()
  update({ phase: 'ready' })
  presentation.setWorkspaceReady(true)
  advance(10_000)
  assert.equal(presentation.getView().phase, 'database-running')
  assert.equal(presentation.getView().canComplete, false)
  presentation.setWindowVisible(true)
  advance(2_000)
  assert.equal(presentation.getView().phase, 'database-running')
  acknowledge()
  advance(599)
  assert.equal(presentation.getView().phase, 'database-running')
  advance(1)
  assert.equal(presentation.getView().phase, 'database-completed')
  advance(3_000)
  assert.equal(presentation.getView().canComplete, false)
  acknowledge()
  advance(499)
  assert.equal(presentation.getView().phase, 'database-completed')
  advance(1)
  assert.equal(presentation.getView().canComplete, true)
})

test('较慢迁移不会在最短显示期到达后提前显示完成', () => {
  const { presentation, update, advance, acknowledge } = fixture()
  update({ database: { status: 'running', operation: 'upgrade' } })
  presentation.setWindowVisible(true)
  acknowledge()
  advance(25_000)
  assert.equal(presentation.getView().phase, 'database-running')
  update({ phase: 'services' })
  assert.equal(presentation.getView().phase, 'database-completed')
  acknowledge()
  advance(500)
  presentation.setWorkspaceReady(true)
  assert.equal(presentation.getView().canComplete, false)
  update({ phase: 'ready' })
  assert.equal(presentation.getView().canComplete, true)
})

test('没有数据库升级时仅使用原来的 650ms 最短可见时间', () => {
  const { presentation, update, advance } = fixture()
  update({ phase: 'ready', database: { status: 'unchanged' } })
  presentation.setWorkspaceReady(true)
  advance(500)
  presentation.setWindowVisible(true)
  advance(649)
  assert.equal(presentation.getView().phase, 'workspace')
  assert.equal(presentation.getView().canComplete, false)
  advance(1)
  assert.equal(presentation.getView().canComplete, true)
})

test('失败立即覆盖最短展示期，取消成功定时器且不允许进入主界面', () => {
  const { presentation, update, advance, acknowledge, timers } = fixture()
  update({ phase: 'ready' })
  presentation.setWorkspaceReady(true)
  presentation.setWindowVisible(true)
  acknowledge()
  advance(200)
  update({ phase: 'failed', failure: { code: 'DB_MIGRATION_FAILED', message: '磁盘空间不足' } })
  assert.equal(presentation.getView().phase, 'error')
  assert.equal(timers.size, 0)
  advance(60_000)
  assert.equal(presentation.getView().canComplete, false)
})

test('首次获知的状态已经失败时不补播升级中和完成状态', () => {
  const { presentation, update } = fixture()
  update({ phase: 'failed', failure: { code: 'DB_VERSION_TOO_NEW', message: '请升级 Termous' } })
  assert.equal(presentation.getView().phase, 'error')
})

test('页面重复显示或重载确认不会重置已开始的阶段计时', () => {
  const { presentation, update, advance, acknowledge } = fixture()
  update({ phase: 'ready' })
  presentation.setWindowVisible(true)
  presentation.setWorkspaceReady(true)
  acknowledge()
  advance(400)
  presentation.setWindowVisible(true)
  acknowledge()
  advance(200)
  assert.equal(presentation.getView().phase, 'database-completed')
  acknowledge()
  advance(500)
  update({ phase: 'ready' })
  assert.equal(presentation.getView().phase, 'workspace')
  assert.equal(presentation.getView().canComplete, true)
})

test('旧启动轮次或旧展示阶段的确认不能推进当前阶段', () => {
  const { presentation, update, advance, acknowledge } = fixture()
  const first = update()
  presentation.setWindowVisible(true)
  const oldAcknowledgement = presentation.getView()
  acknowledge()
  advance(200)
  update({ attemptId: 'attempt-2' })
  presentation.update(first)
  presentation.presented(oldAcknowledgement)
  advance(1_000)
  assert.equal(presentation.getView().attemptId, 'attempt-2')
  assert.equal(presentation.getView().phase, 'database-running')
  acknowledge()
  advance(600)
  assert.equal(presentation.getView().phase, 'database-completed')
})

test('心跳更新不会改变当前展示阶段标识或延长升级提示', () => {
  const { presentation, update, advance, acknowledge } = fixture()
  update()
  presentation.setWindowVisible(true)
  const firstId = presentation.getView().presentationId
  acknowledge()
  advance(300)
  update()
  assert.equal(presentation.getView().presentationId, firstId)
  advance(300)
  assert.equal(presentation.getView().phase, 'database-completed')
})

test('启动窗口加载失败仅跳过展示，继续遵守 Core 与工作区就绪条件', () => {
  const { presentation, update } = fixture()
  update({ phase: 'services' })
  presentation.skipPresentation()
  presentation.setWorkspaceReady(true)
  assert.equal(presentation.getView().canComplete, false)
  update({ phase: 'ready' })
  assert.equal(presentation.getView().canComplete, true)
  update({ phase: 'failed', failure: { code: 'CORE_START_FAILED', message: '启动失败' } })
  assert.equal(presentation.getView().canComplete, false)
})

test('隐藏启动窗口不会被当作加载失败跳过展示', () => {
  const { presentation, update, advance } = fixture()
  update({ phase: 'ready' })
  presentation.setWindowVisible(true)
  presentation.setWorkspaceReady(true)
  presentation.setWindowVisible(false)
  advance(60_000)
  assert.equal(presentation.getView().canComplete, false)
})

test('外部 Core 不展示数据库升级但仍等待工作区就绪', () => {
  const { presentation, update, advance } = fixture()
  update({ phase: 'external', database: null })
  presentation.setWindowVisible(true)
  advance(650)
  assert.equal(presentation.getView().canComplete, false)
  presentation.setWorkspaceReady(true)
  assert.equal(presentation.getView().canComplete, true)
})

test('销毁展示控制器会清理所有定时器', () => {
  const { presentation, update, acknowledge, timers } = fixture()
  update()
  presentation.setWindowVisible(true)
  acknowledge()
  assert.equal(timers.size, 1)
  presentation.dispose()
  assert.equal(timers.size, 0)
})

test('前端启动失败不占用 Core revision，同轮保留错误且新轮次正常恢复', () => {
  const { presentation, update } = fixture()
  update({ phase: 'ready' })
  presentation.setFailure({ code: 'WORKSPACE_START_FAILED', message: '工作区加载失败' })
  presentation.setFailure(null)
  update({ phase: 'ready' })
  assert.equal(presentation.getView().phase, 'error')
  update({ attemptId: 'attempt-2', phase: 'starting', database: null })
  assert.equal(presentation.getView().phase, 'core')
  assert.equal(presentation.getView().failure, null)
})

test('新启动轮次重新等待窗口展示，不能沿用上一轮加载失败的跳过标记', () => {
  const { presentation, update } = fixture()
  update({ phase: 'ready' })
  presentation.skipPresentation()
  presentation.setWorkspaceReady(true)
  assert.equal(presentation.getView().canComplete, true)
  update({ attemptId: 'attempt-2', phase: 'ready' })
  presentation.setWorkspaceReady(true)
  assert.equal(presentation.getView().canComplete, false)
})
