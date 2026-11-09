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
      attention: null, windowVisible: true, ready: false, canComplete: false, ...patch,
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
    assert.equal(f.text('status'), '数据库升级失败')
    assert.match(f.text('details-text') ?? '', /磁盘空间不足/)
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
    assert.doesNotMatch(f.text('description') ?? '', /<img|<script>/)
    assert.match(f.text('details-text') ?? '', /<img src=x onerror="alert\(1\)">/)
    assert.match(f.text('details-text') ?? '', /<script>bad\(\)<\/script>/)
    assert.match(f.text('details-text') ?? '', /起始版本: 0/)
    assert.equal(f.window.document.activeElement?.id, 'startup-copy')
  } finally { f.window.close() }
})

test('完成后的其他启动错误不会被描述为数据库升级失败', () => {
  const f = fixture()
  try {
    f.publish(f.state({ phase: 'error', database: { status: 'completed', operation: 'upgrade' },
      failure: { code: 'CORE_START_FAILED', message: '凭据初始化失败' } }))
    assert.doesNotMatch(f.text('description') ?? '', /数据库|凭据/)
    assert.match(f.text('details-text') ?? '', /凭据初始化失败/)
    assert.equal(f.text('status'), '启动失败')
  } finally { f.window.close() }
})

test('普通准备与实际升级使用准确的中英文提示且不展示数字进度', () => {
  const f = fixture()
  try {
    f.publish(f.state({ database: { status: 'running', operation: 'initialize' } }))
    assert.equal(f.text('status'), '正在准备…')
    f.publish(f.state({ sequence: 2, phase: 'database-completed', database: { status: 'completed', operation: 'adopt' } }, 'en-US'))
    assert.equal(f.text('status'), 'Database upgrade complete')
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
    assert.match(f.text('feedback') ?? '', /操作失败/)
    assert.equal((f.window.document.getElementById('startup-copy') as HTMLButtonElement).disabled, false)
    f.window.document.getElementById('startup-logs')?.click()
    f.window.document.getElementById('startup-exit')?.click()
    await Promise.resolve()
    assert.deepEqual(f.actions, ['copy', 'logs', 'exit'])
  } finally { f.window.close() }
})

test('每次启动的准备和首次初始化不提数据库，同版本检查完成直接提示就绪', () => {
  const f = fixture()
  try {
    let sequence = 0
    for (const locale of ['zh-CN', 'en-US']) {
      for (const operation of ['initialize', 'prepare'] as const) {
        for (const fromVersion of [undefined, 0, 2]) {
          const database = { operation, fromVersion, targetVersion: 2 }
          f.publish(f.state({ sequence: ++sequence, database: { ...database, status: 'running' } }, locale))
          assert.equal(f.text('status'), locale === 'zh-CN' ? '正在准备…' : 'Preparing…')
          f.publish(f.state({ sequence: ++sequence, phase: 'database-completed', ready: true, database: { ...database, status: 'completed' } }, locale))
          assert.equal(f.text('status'), locale === 'zh-CN' ? '准备就绪' : 'Ready')
          assert.equal(f.text('description'), '')
        }
      }
      f.publish(f.state({ sequence: ++sequence, phase: 'checking', database: { status: 'checking' } }, locale))
      assert.equal(f.text('status'), locale === 'zh-CN' ? '正在准备…' : 'Preparing…')
    }
  } finally { f.window.close() }
})

test('领域库版本上升会提示升级，后续同版本准备不会覆盖本轮升级结果', () => {
  const f = fixture()
  try {
    const upgrade = { id: '1-2', domain: 'agent', status: 'running', operation: 'prepare', fromVersion: 1, targetVersion: 2 } as const
    f.publish(f.state({ database: upgrade, databases: [upgrade] }))
    assert.equal(f.text('status'), '正在升级数据库…')
    const completed = { ...upgrade, status: 'completed' } as const
    const check = { id: '2-1', domain: 'audit', status: 'completed', operation: 'prepare', fromVersion: 1, targetVersion: 1 } as const
    f.publish(f.state({ sequence: 2, phase: 'database-completed', database: check, databases: [completed, check] }))
    assert.equal(f.text('status'), '数据库升级完成')
    const failed = { ...check, status: 'failed', code: 'DB_OPEN_FAILED' } as const
    f.publish(f.state({ sequence: 3, phase: 'database-completed', ready: true, database: failed, databases: [completed, failed] }, 'en-US'))
    assert.equal(f.text('status'), 'Ready')
    assert.equal(f.text('description'), 'Unavailable: Audit')
    assert.equal(f.window.document.getElementById('startup-details')?.hidden, false)
    assert.equal(f.window.document.body.dataset.attention, 'true')
  } finally { f.window.close() }
})

test('失败只展示一条本地化建议，底层原因和错误码仍可在详情查看', () => {
  const f = fixture()
  try {
    let sequence = 0
    for (const locale of ['zh-CN', 'en-US']) {
      for (const code of ['DB_VERSION_TOO_NEW', 'DB_LEGACY_UNSUPPORTED', 'DB_HISTORY_INVALID', 'DB_SCHEMA_INVALID',
        'DB_OPEN_FAILED', 'DB_MIGRATION_FAILED', 'CORE_BIND_FAILED', 'CORE_BINARY_NOT_FOUND', 'CORE_START_TIMEOUT',
        'LOCAL_API_UNAVAILABLE', 'CORE_START_FAILED', 'UNRECOGNIZED_FAILURE']) {
        f.publish(f.state({ sequence: ++sequence, phase: 'error', failure: {
          code, message: '底层原因：旧版冗余提示', details: '原始诊断详情',
        } }, locale))
        const description = f.text('description') ?? ''
        assert.ok(description)
        assert.ok(f.text('status'))
        assert.doesNotMatch(description, /旧版冗余提示|\n/)
        if (locale === 'en-US') assert.doesNotMatch(description + f.text('status'), /\p{Script=Han}/u)
        assert.ok(f.text('details-text')?.includes(code))
        assert.match(f.text('details-text') ?? '', /底层原因：旧版冗余提示/)
        assert.match(f.text('details-text') ?? '', /原始诊断详情/)
      }
    }
  } finally { f.window.close() }
})

test('首次准备失败不误报升级失败，只有确认升级时才显示升级失败', () => {
  const f = fixture()
  try {
    f.publish(f.state({ phase: 'error', database: { status: 'failed', operation: 'prepare', targetVersion: 2 },
      failure: { code: 'DB_MIGRATION_FAILED', message: '准备失败' } }))
    assert.equal(f.text('status'), '无法准备本地数据')
    f.publish(f.state({ sequence: 2, phase: 'error', database: null,
      failure: { code: 'DB_MIGRATION_FAILED', message: '准备失败', fromVersion: 1, targetVersion: 2 } }))
    assert.equal(f.text('status'), '数据库升级失败')
    f.publish(f.state({ sequence: 3, phase: 'error', database: { status: 'failed', operation: 'prepare', fromVersion: 2, targetVersion: 2 },
      databases: [{ id: '1-51', domain: 'core', status: 'completed', operation: 'upgrade', fromVersion: 50, targetVersion: 51 }],
      failure: { code: 'DB_MIGRATION_FAILED', message: '当前库准备失败', fromVersion: 2, targetVersion: 2 } }))
    assert.equal(f.text('status'), '无法准备本地数据')
  } finally { f.window.close() }
})

test('首次建库的后续版本脚本仍属于初始化，不能提示已有数据升级', () => {
  const f = fixture()
  try {
    const initialized = { id: '1-50', domain: 'core', role: 'source', operation: 'initialize', status: 'completed', fromVersion: 0, targetVersion: 50 } as const
    const configuration = { id: '1-51', domain: 'core', role: 'source', operation: 'upgrade', status: 'completed', fromVersion: 50, targetVersion: 51 } as const
    const agent = { id: '4-4', domain: 'agent', role: 'live', operation: 'prepare', status: 'running', fromVersion: 2, targetVersion: 4 } as const
    const databases = [initialized, configuration, agent]
    f.publish(f.state({ database: agent, databases }))
    assert.equal(f.text('status'), '正在准备…')
    f.publish(f.state({ sequence: 2, phase: 'database-completed', ready: true, database: { ...agent, status: 'completed' },
      databases: [initialized, configuration, { ...agent, status: 'completed' }] }))
    assert.equal(f.text('status'), '准备就绪')
    f.publish(f.state({ sequence: 3, phase: 'error', database: { ...agent, status: 'failed', code: 'DB_MIGRATION_FAILED' }, databases,
      failure: { code: 'DB_MIGRATION_FAILED', message: '首次准备失败', fromVersion: 2, targetVersion: 4 } }))
    assert.equal(f.text('status'), '无法准备本地数据')
    f.publish(f.state({ sequence: 4, database: configuration, databases: [{ ...initialized, role: 'rollback' }, configuration] }))
    assert.equal(f.text('status'), '正在升级数据库…')
  } finally { f.window.close() }
})

test('普通准备结束仍需等待工作区就绪，再显示完成样式', () => {
  const f = fixture()
  try {
    const database = { status: 'completed', operation: 'prepare', fromVersion: 4, targetVersion: 4 } as const
    f.publish(f.state({ phase: 'database-completed', database }))
    assert.equal(f.text('status'), '正在准备工作区…')
    assert.equal(f.window.document.body.dataset.phase, 'workspace')
    f.frame()
    f.frame()
    assert.equal(f.acknowledgements.length, 1)
    f.publish(f.state({ sequence: 2, phase: 'workspace', ready: true, database }))
    assert.equal(f.text('status'), '准备就绪')
    assert.equal(f.window.document.body.dataset.phase, 'ready')
  } finally { f.window.close() }
})

test('同版本接管失败按实际操作归因，后续库完成也不能覆盖最初失败', () => {
  const f = fixture()
  try {
    const failed = { id: '1-25', domain: 'core', role: 'source', operation: 'adopt', status: 'failed', fromVersion: 25, targetVersion: 25, code: 'DB_MIGRATION_FAILED' } as const
    f.publish(f.state({ phase: 'error', database: { id: '2-2', domain: 'agent', role: 'staged', operation: 'prepare', status: 'completed', targetVersion: 2 },
      databases: [failed], failure: { code: 'DB_MIGRATION_FAILED', message: '迁移记录写入失败', databaseRole: 'source', fromVersion: 25, targetVersion: 25 } }))
    assert.equal(f.text('status'), '数据库升级失败')
    assert.match(f.text('details-text') ?? '', /迁移记录写入失败/)
    f.publish(f.state({ sequence: 2, phase: 'error', database: null, failure: { code: 'constructor', message: '未知错误' } }))
    assert.equal(f.text('status'), '启动失败')
    assert.ok(f.text('description'))
  } finally { f.window.close() }
})
