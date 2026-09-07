import assert from 'node:assert/strict'
import test from 'node:test'
import { RemoteDesktopTargetAuthController } from './targetAuthController.ts'

const passwordField = [{ id: 'password', kind: 'secret' as const, required: true }]

test('password-only 请求消费一次性票据并提交保存密码', async () => {
  const controller = new RemoteDesktopTargetAuthController()
  const consumed: string[] = []
  const submitted: unknown[] = []
  controller.reset('ticket-1')

  await controller.handleRequest({
    fields: passwordField,
    consume: async (ticket) => {
      consumed.push(ticket)
      return { password: 'saved-password' }
    },
    isCurrent: () => true,
    submit: (credentials) => submitted.push(credentials),
    fallback: () => assert.fail('不应回退手工认证'),
  })

  assert.deepEqual(consumed, ['ticket-1'])
  assert.deepEqual(submitted, [{ password: 'saved-password' }])
})

test('username 或 target 请求保持手工认证且不消费票据', async () => {
  for (const id of ['username', 'target']) {
    const controller = new RemoteDesktopTargetAuthController()
    let fallbackCount = 0
    controller.reset('ticket-1')
    await controller.handleRequest({
      fields: [{ id, kind: 'text', required: true }],
      consume: async () => assert.fail('不应消费目标认证票据'),
      isCurrent: () => true,
      submit: () => assert.fail('不应自动提交凭据'),
      fallback: () => { fallbackCount += 1 },
    })
    assert.equal(fallbackCount, 1)
  }
})

test('未绑定保存凭据时直接回退手工认证', async () => {
  const controller = new RemoteDesktopTargetAuthController()
  let fallbackCount = 0
  controller.reset('')
  await controller.handleRequest({
    fields: passwordField,
    consume: async () => assert.fail('空票据不应发起读取请求'),
    isCurrent: () => true,
    submit: () => assert.fail('空票据不应自动提交凭据'),
    fallback: () => { fallbackCount += 1 },
  })
  assert.equal(fallbackCount, 1)
})

test('票据不可用或密码响应无效时回退手工认证且不重复消费', async () => {
  for (const failure of [
    new Error('REMOTE_DESKTOP_PROFILE_NOT_FOUND'),
    new Error('VAULT_LOCKED'),
    { password: '密'.repeat(2_049) },
  ]) {
    const controller = new RemoteDesktopTargetAuthController()
    let consumeCount = 0
    let fallbackCount = 0
    controller.reset('ticket-1')
    const request = {
      fields: passwordField,
      consume: async () => {
        consumeCount += 1
        if (failure instanceof Error) throw failure
        return failure
      },
      isCurrent: () => true,
      submit: () => assert.fail('不应自动提交无效凭据'),
      fallback: () => { fallbackCount += 1 },
    }
    await controller.handleRequest(request)
    await controller.handleRequest(request)
    assert.equal(consumeCount, 1)
    assert.equal(fallbackCount, 2)
  }
})

test('代次变化会使在途响应失效且不会泄漏到新 Viewer', async () => {
  const controller = new RemoteDesktopTargetAuthController()
  let resolve!: (value: { password: string }) => void
  const response = new Promise<{ password: string }>((done) => { resolve = done })
  let submitted = false
  let fallback = false
  controller.reset('ticket-1')
  const pending = controller.handleRequest({
    fields: passwordField,
    consume: async () => response,
    isCurrent: () => true,
    submit: () => { submitted = true },
    fallback: () => { fallback = true },
  })

  controller.clear()
  resolve({ password: 'stale-password' })
  await pending

  assert.equal(submitted, false)
  assert.equal(fallback, false)
})
