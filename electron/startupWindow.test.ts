import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { setImmediate } from 'node:timers/promises'
import type { StartupWindowBridge, StartupWindowState } from './startupPresentation.ts'

type TestWindow = Window & typeof globalThis & {
  termousStartupBridge: StartupWindowBridge
}
const JSDOM = createRequire(import.meta.url)('jsdom').JSDOM as new (html: string, options: object) => { window: TestWindow }
const html = readFileSync(new URL('../public/startup.html', import.meta.url), 'utf8')
const script = readFileSync(new URL('../public/startup.js', import.meta.url), 'utf8')

function fixture() {
  const { window } = new JSDOM(html, {
    url: 'https://termous.local/startup.html?locale=zh-CN',
    runScripts: 'outside-only', pretendToBeVisual: true,
  })
  let publish: (state: StartupWindowState) => void = () => undefined
  let resolveStatus: (state: StartupWindowState) => void = () => undefined
  let frameID = 0
  let copyFails = false
  const frames = new Map<number, FrameRequestCallback>()
  const acknowledgements: Parameters<StartupWindowBridge['presented']>[0][] = []
  const actions: string[] = []
  window.requestAnimationFrame = (callback) => {
    frames.set(++frameID, callback)
    return frameID
  }
  window.cancelAnimationFrame = (id) => { frames.delete(id) }
  window.termousStartupBridge = {
    status: () => new Promise((resolve) => { resolveStatus = resolve }),
    onChanged: (callback) => { publish = callback; return () => undefined },
    presented: (acknowledgement) => acknowledgements.push(acknowledgement),
    copyDiagnostics: async () => { actions.push('copy'); if (copyFails) throw new Error('复制失败') },
    openLogs: async () => { actions.push('logs') },
    exit: async () => { actions.push('exit') },
  }
  window.eval(script)
  const state = (patch: Partial<StartupWindowState['view']> = {}, locale = 'zh-CN'): StartupWindowState => ({
    theme: 'dark', locale,
    view: {
      attemptId: 'attempt-1', sequence: 1, presentationId: 1, phase: 'database-running',
      database: { status: 'running', operation: 'upgrade' }, failure: null,
      attention: null, windowVisible: true, canComplete: false, ...patch,
    },
  })
  const frame = () => {
    const pending = [...frames.values()]
    frames.clear()
    pending.forEach((callback) => callback(0))
  }
  return {
    window, state, frame, acknowledgements, actions,
    publish: (next: StartupWindowState) => publish(next),
    resolveStatus: (next: StartupWindowState) => resolveStatus(next),
    failCopy: () => { copyFails = true },
    text: (id: string) => window.document.getElementById(`startup-${id}`)?.textContent,
  }
}

test('启动页先订阅再取快照，迟到快照不能覆盖较新失败状态', async () => {
  const f = fixture()
  try {
    f.publish(f.state({ sequence: 2, phase: 'error', failure: { code: 'DB_MIGRATION_FAILED', message: '磁盘空间不足' } }))
    f.resolveStatus(f.state())
    await Promise.resolve()
    assert.equal(f.window.document.body.dataset.phase, 'error')
    assert.match(f.text('description') ?? '', /磁盘空间不足/)
  } finally { f.window.close() }
})

test('只有实际渲染两帧后的当前阶段会被确认，心跳不重复确认', () => {
  const f = fixture()
  try {
    f.publish(f.state())
    f.frame()
    assert.equal(f.acknowledgements.length, 0)
    f.frame()
    assert.equal(f.acknowledgements.length, 1)
    f.publish(f.state({ sequence: 2 }))
    f.frame()
    f.frame()
    assert.equal(f.acknowledgements.length, 1)
  } finally { f.window.close() }
})

test('渲染确认前进入失败态时不会确认已经过期的升级阶段', () => {
  const f = fixture()
  try {
    f.publish(f.state())
    f.frame()
    f.publish(f.state({ sequence: 2, presentationId: 2, phase: 'error', failure: { code: 'DB_OPEN_FAILED', message: '无法打开数据库' } }))
    f.frame()
    f.frame()
    f.frame()
    assert.equal(f.acknowledgements.length, 1)
    assert.equal(f.acknowledgements[0].presentationId, 2)
  } finally { f.window.close() }
})

test('隐藏窗口的文档即使报告可见，也要等主进程实际展示后再确认阶段', () => {
  const f = fixture()
  try {
    f.publish(f.state({ windowVisible: false }))
    f.frame()
    f.frame()
    assert.equal(f.acknowledgements.length, 0)
    f.publish(f.state({ sequence: 2, windowVisible: true }))
    f.frame()
    f.frame()
    assert.equal(f.acknowledgements.length, 1)
  } finally { f.window.close() }
})

test('错误内容仅作为文本显示，详情保留版本零并优先聚焦诊断操作', () => {
  const f = fixture()
  try {
    f.publish(f.state({ phase: 'error', failure: {
      code: 'DB_MIGRATION_FAILED', message: '<img src=x onerror="alert(1)">',
      details: '<script>bad()</script>', fromVersion: 0, targetVersion: 25,
    } }))
    assert.equal(f.window.document.querySelector('#startup-description img'), null)
    assert.equal(f.window.document.querySelector('#startup-details-text script'), null)
    assert.match(f.text('details-text') ?? '', /起始版本: 0/)
    assert.equal(f.window.document.activeElement?.id, 'startup-copy')
  } finally { f.window.close() }
})

test('完成后的其他启动错误不会被描述为数据库升级失败', () => {
  const f = fixture()
  try {
    f.publish(f.state({ phase: 'error', database: { status: 'completed', operation: 'upgrade' },
      failure: { code: 'CORE_START_FAILED', message: '凭据初始化失败' } }))
    assert.match(f.text('description') ?? '', /数据库处理已完成/)
    assert.equal(f.text('status'), '应用启动未完成')
  } finally { f.window.close() }
})

test('初始化、基线接管与升级均有中英文状态且不展示数字进度', () => {
  const f = fixture()
  try {
    f.publish(f.state({ database: { status: 'running', operation: 'initialize' } }))
    assert.equal(f.text('status'), '正在初始化数据库…')
    f.publish(f.state({ sequence: 2, phase: 'database-completed', database: { status: 'completed', operation: 'adopt' } }, 'en-US'))
    assert.equal(f.text('status'), 'Database updated')
    assert.equal(f.window.document.documentElement.lang, 'en-US')
    assert.equal(f.window.document.querySelector('[role="progressbar"]'), null)
  } finally { f.window.close() }
})

test('异常等待提供退出和日志操作，复制失败有反馈且按钮可重试', async () => {
  const f = fixture()
  try {
    f.publish(f.state({ attention: 'unresponsive' }))
    assert.equal(f.window.document.getElementById('startup-actions')?.hidden, false)
    assert.match(f.text('description') ?? '', /无法确认/)
    f.failCopy()
    f.window.document.getElementById('startup-copy')?.click()
    await setImmediate()
    assert.match(f.text('feedback') ?? '', /操作未完成/)
    assert.equal((f.window.document.getElementById('startup-copy') as HTMLButtonElement).disabled, false)
    f.window.document.getElementById('startup-logs')?.click()
    f.window.document.getElementById('startup-exit')?.click()
    await Promise.resolve()
    assert.deepEqual(f.actions, ['copy', 'logs', 'exit'])
  } finally { f.window.close() }
})
