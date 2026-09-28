import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentSession } from '#entities/agent'
import { agentSessionFixture } from '../model/agentRuntimeTestFixtures.ts'
import { AgentDraftSessionCoordinator } from './AgentDraftSessionCoordinator.ts'

test('草稿附件与 Slash 并发时共享同一个会话创建 Promise', async () => {
  const coordinator = new AgentDraftSessionCoordinator()
  let resolve!: (session: AgentSession) => void
  const create = () => new Promise<AgentSession>((done) => { resolve = done })

  const attachment = coordinator.ensure(1, create)
  const slash = coordinator.ensure(1, () => Promise.reject(new Error('不应再次创建')))
  assert.equal(attachment, slash)
  assert.equal(coordinator.current(1), attachment)

  await Promise.resolve()
  resolve(agentSessionFixture({ id: 'shared-session' }))
  assert.equal((await slash).id, 'shared-session')
  coordinator.release(attachment)
  coordinator.release(slash)
  assert.equal(coordinator.current(1), undefined)
})

test('共享创建 Promise 在单个调用者释放后仍保持，避免并发重复创建', async () => {
  const coordinator = new AgentDraftSessionCoordinator()
  let resolve!: (session: AgentSession) => void
  const first = coordinator.ensure(1, () => new Promise<AgentSession>((done) => { resolve = done }))
  const second = coordinator.ensure(1, () => Promise.reject(new Error('不应再次创建')))

  coordinator.release(first)
  assert.equal(coordinator.current(1), second)
  resolve(agentSessionFixture({ id: 'shared-session' }))
  await second
  assert.equal(coordinator.current(1), second)

  coordinator.release(second)
  assert.equal(coordinator.current(1), undefined)
})

test('旁路 acquire 必须配对 release，检查 current 不会隐式占用引用', async () => {
  const coordinator = new AgentDraftSessionCoordinator()
  const created = coordinator.ensure(1, async () => agentSessionFixture({ id: 'session' }))
  await created
  assert.equal(coordinator.current(1), created)

  const borrowed = coordinator.acquire(1)
  assert.equal(borrowed, created)
  coordinator.release(created)
  assert.equal(coordinator.current(1), created)
  coordinator.release(borrowed!)
  assert.equal(coordinator.current(1), undefined)
})

test('创建失败自动释放槽位，后续重试可以创建新会话', async () => {
  const coordinator = new AgentDraftSessionCoordinator()
  const failure = new Error('create failed')
  const first = coordinator.ensure(1, () => Promise.reject(failure))

  await assert.rejects(first, failure)
  assert.equal(coordinator.current(1), undefined)

  const recovered = coordinator.ensure(1, async () => agentSessionFixture({ id: 'retry-session' }))
  assert.equal((await recovered).id, 'retry-session')
})

test('只有当前创建 Promise 可以释放共享槽位', async () => {
  const coordinator = new AgentDraftSessionCoordinator()
  const current = coordinator.ensure(1, async () => agentSessionFixture())
  const unrelated = Promise.resolve(agentSessionFixture({ id: 'unrelated' }))

  coordinator.release(unrelated)
  assert.equal(coordinator.current(1), current)
  await current
  coordinator.release(current)
  assert.equal(coordinator.current(1), undefined)
})

test('不同草稿代次使用独立创建 Promise，旧回执不能释放新槽位', async () => {
  const coordinator = new AgentDraftSessionCoordinator()
  let resolveFirst!: (session: AgentSession) => void
  let resolveSecond!: (session: AgentSession) => void
  const first = coordinator.ensure(1, () => new Promise<AgentSession>((resolve) => { resolveFirst = resolve }))
  const second = coordinator.ensure(2, () => new Promise<AgentSession>((resolve) => { resolveSecond = resolve }))

  assert.notEqual(first, second)
  assert.equal(coordinator.current(1), undefined)
  assert.equal(coordinator.current(2), second)

  resolveFirst(agentSessionFixture({ id: 'old-session' }))
  assert.equal((await first).id, 'old-session')
  coordinator.release(first)
  assert.equal(coordinator.current(2), second)

  resolveSecond(agentSessionFixture({ id: 'new-session' }))
  assert.equal((await second).id, 'new-session')
  coordinator.release(second)
  assert.equal(coordinator.current(2), undefined)
})
