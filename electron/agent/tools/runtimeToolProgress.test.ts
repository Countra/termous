import assert from 'node:assert/strict'
import test from 'node:test'
import { RuntimeToolProgress } from './runtimeToolProgress.ts'
import { RuntimeToolDiscovery } from './runtimeToolDiscovery.ts'
import { Type } from 'typebox'

const skill = (uri = 'skill://fixture/SKILL.md') => ({ content: [{ type: 'text' as const, text: '文档' }], details: { kind: 'skill_resource', uri, sha256: 'same', size: 6 } })
const read = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], details: { kind: 'mcp', originalToolName: 'fixture', readOnly: true, result: { content: [], structuredContent: value } } })
const write = (value: unknown) => { const result = read(value); result.details.readOnly = false; return result }

test('重复门禁只阻止相同资源，显式发现可恢复声明但不能重放已封锁的读取', async () => {
  const progress = new RuntimeToolProgress()
  const name = 'termous.hosts.get'
  for (let i = 0; i < 3; i++) progress.observe(name, { id: 'a' }, read({ id: 'a' }), false)
  assert.ok(progress.beforeCall(name, { id: 'a', client_request_id: 'new' }))
  assert.equal(progress.beforeCall(name, { id: 'b' }), undefined)
  const tool = { name, label: name, description: name, parameters: Type.Object({ id: Type.String() }), execute: async () => read({}) }
  const discovery = new RuntimeToolDiscovery([tool], (v) => v, [], undefined, (v) => progress.rediscover(v))
  await discovery.tool.execute('find', { names: [name] })
  assert.ok(discovery.publish().some((v) => v.name === name && !progress.hidden(v.name)))
  assert.ok(progress.beforeCall(name, { id: 'a' }))
  assert.equal(progress.beforeCall(name, { id: 'b' }), undefined)
})

test('一个 Skill 重复不会封锁另一个，退出上下文后按资源恢复', async () => {
  const progress = new RuntimeToolProgress()
  const name = 'read_skill_resource'
  const uri = 'skill://fixture/A'
  for (let i = 0; i < 3; i++) progress.observe(name, { uri }, skill(uri), false)
  assert.ok(progress.beforeCall(name, { uri, refresh: true }))
  assert.equal(progress.beforeCall(name, { uri: 'skill://fixture/B' }), undefined)
  const tool = { name, label: name, description: name, parameters: Type.Object({ uri: Type.String() }), execute: async () => skill() }
  const discovery = new RuntimeToolDiscovery([], () => null, [tool], undefined, (v) => progress.rediscover(v))
  await discovery.tool.execute('find', { names: [name] })
  assert.equal(progress.hidden(name), false)
  assert.equal(discovery.publish().filter((v) => v.name === name).length, 1)
  assert.ok(progress.beforeCall(name, { uri }))
  progress.contextChanged((value) => value !== uri)
  assert.equal(progress.beforeCall(name, { uri }), undefined)
})

test('成功重复读取也识别无进展，refresh 和请求 ID 不能绕过；不终止任务', () => {
  const progress = new RuntimeToolProgress()
  assert.equal(progress.observe('read_skill_resource', { refresh: false }, skill(), false), undefined)
  assert.match(progress.observe('read_skill_resource', { refresh: true }, skill(), false)!, /discover_tools/)
  progress.observe('read_skill_resource', { refresh: true, client_request_id: 'new' }, skill(), false)
  assert.ok(progress.blocked('read_skill_resource'))
  assert.equal(progress.blocked('discover_tools'), undefined)
  assert.equal(progress.blocked('termous.desktops.attach'), undefined)
  progress.observe('discover_tools', {}, { content: [], details: {} }, false)
  assert.ok(progress.blocked('read_skill_resource'))
  progress.observe('termous.desktops.attach', {}, { content: [], details: {} }, false)
  assert.equal(progress.blocked('read_skill_resource'), undefined)
})

test('多个资源、上下文压缩和用户补充不会永久封锁 Skill', () => {
  const progress = new RuntimeToolProgress()
  progress.observe('read_skill_resource', {}, skill('skill://fixture/A'), false)
  progress.observe('read_skill_resource', {}, skill('skill://fixture/B'), false)
  assert.equal(progress.blocked('read_skill_resource'), undefined)
  for (let i = 0; i < 3; i++) progress.observe('read_skill_resource', {}, skill(), false)
  progress.contextChanged(() => true)
  assert.ok(progress.blocked('read_skill_resource'))
  progress.contextChanged(() => false)
  assert.equal(progress.blocked('read_skill_resource'), undefined)
  for (let i = 0; i < 3; i++) progress.observe('read_skill_resource', {}, skill(), false)
  progress.reset()
  assert.equal(progress.blocked('read_skill_resource'), undefined)
})

test('任意标记为只读的工具共享纠正入口，真实变化后允许重查', () => {
  const progress = new RuntimeToolProgress()
  for (let i = 0; i < 3; i++) progress.observe('termous.hosts.list', { b: 2, a: 1, client_request_id: String(i) }, read({ hosts: ['one'] }), false)
  assert.ok(progress.blocked('termous.hosts.list'))
  progress.observe('termous.hosts.get', { id: 'one' }, read({ host: { revision: 1 } }), false)
  progress.observe('termous.hosts.get', { id: 'one' }, read({ host: { revision: 2 } }), false)
  assert.equal(progress.blocked('termous.hosts.list'), undefined)
})

test('审批、运行状态轮询及错误不会当作重复成功查询撤下', () => {
  const progress = new RuntimeToolProgress()
  for (let i = 0; i < 8; i++) {
    progress.observe('run.get', {}, read({ report: { run: { state: 'preparing', phase: 'waiting_approval' } } }), false)
    progress.observe('watch.get', { after_revision: 2 }, read({ value: 1 }), false)
    progress.observe('failed.get', {}, read({ error: 'unavailable' }), true)
  }
  for (const name of ['run.get', 'watch.get', 'failed.get']) assert.equal(progress.blocked(name), undefined)
})

test('终态查询不能通过更改轮询时间或修订号绕过重复保护', () => {
  const progress = new RuntimeToolProgress()
  for (let i = 0; i < 3; i++) progress.observe('run.get', { run_id: 'done', after_revision: i, wait_ms: 1000 + i }, read({ report: { run: { state: 'completed', revision: 3 } } }), false)
  assert.ok(progress.beforeCall('run.get', { run_id: 'done', after_revision: 3, wait_ms: 10 }))
  assert.equal(progress.beforeCall('run.get', { run_id: 'other' }), undefined)
})

test('已释放快照不因换请求标识再次派发，其他资源和后续创建仍可清理', () => {
  const progress = new RuntimeToolProgress()
  const name = 'termous.desktop_workflows.captures.release'
  const args = { snapshot_id: 'old', client_request_id: 'one' }
  assert.equal(progress.beforeCall(name, args), undefined)
  progress.observe(name, args, write({ completed: true }), false)
  assert.match(progress.beforeCall(name, { ...args, client_request_id: 'two' })!, /captures.create/)
  assert.equal(progress.hidden(name), true)
  assert.equal(progress.beforeCall(name, { snapshot_id: 'other' }), undefined)
  progress.rediscover(name)
  assert.equal(progress.hidden(name), false)
  assert.ok(progress.beforeCall(name, args))
  progress.observe('termous.desktop_workflows.captures.create', {}, write({ snapshot: { snapshot_id: 'new' } }), false)
  assert.equal(progress.hidden(name), false)
  assert.equal(progress.beforeCall(name, { snapshot_id: 'new' }), undefined)
  progress.reset()
  assert.ok(progress.beforeCall(name, args))
})

test('只有明确确认的终态才保护；不吞失败，不把其他代次或可重连会话永久关闭', () => {
  const progress = new RuntimeToolProgress()
  const name = 'termous.desktops.control.release'
  const args = { attachment_id: 'a', grant_id: 'g1' }
  progress.observe(name, args, write({ completed: true }), true)
  assert.equal(progress.beforeCall(name, args), undefined)
  progress.observe(name, args, write({ completed: false }), false)
  assert.equal(progress.beforeCall(name, args), undefined)
  progress.observe(name, args, write({ completed: true }), false)
  assert.ok(progress.beforeCall(name, args))
  assert.equal(progress.beforeCall(name, { ...args, grant_id: 'g2' }), undefined)
  progress.observe('termous.desktops.close', { session_id: 's', connection_generation: 1 }, write({ completed: true }), false)
  assert.equal(progress.beforeCall('termous.desktops.close', { session_id: 's', connection_generation: 2 }), undefined)
  for (const other of ['termous.files.sessions.close', 'termous.commands.interrupt', 'termous.desktop_workflows.runs.control']) {
    progress.observe(other, args, write({ closed: true, completed: true }), false)
    assert.equal(progress.beforeCall(other, args), undefined)
  }
})

test('重复无变化写入不重置读取纠正，但合法重复输入没有次数上限', () => {
  const progress = new RuntimeToolProgress()
  const name = 'termous.desktops.keyboard.key'
  progress.observe(name, { code: 'ArrowDown' }, write({ accepted: true }), false)
  for (let i = 0; i < 3; i++) progress.observe('read_skill_resource', {}, skill(), false)
  for (let i = 0; i < 100; i++) {
    assert.equal(progress.beforeCall(name, { code: 'ArrowDown', client_request_id: String(i) }), undefined)
    progress.observe(name, { code: 'ArrowDown', client_request_id: String(i) }, write({ accepted: true }), false)
    assert.ok(progress.blocked('read_skill_resource'))
  }
  progress.observe('termous.desktops.capture', {}, read({ capture: { frame: 2 } }), false)
  assert.equal(progress.blocked('read_skill_resource'), undefined)
})
