import assert from 'node:assert/strict'
import test from 'node:test'
import {
  installUpdateSimulationNetworkGuard,
  isAllowedUpdateSimulationURL,
} from './updateSimulationSecurity.ts'

const feedURL = 'http://127.0.0.1:18991'

test('更新模拟网络边界只允许固定 loopback feed', () => {
  assert.equal(
    isAllowedUpdateSimulationURL(
      'http://127.0.0.1:18991/latest.yml',
      feedURL,
    ),
    true,
  )
  assert.equal(
    isAllowedUpdateSimulationURL(
      'http://localhost:18991/latest.yml',
      feedURL,
    ),
    false,
  )
  assert.equal(
    isAllowedUpdateSimulationURL(
      'http://127.0.0.1:18992/latest.yml',
      feedURL,
    ),
    false,
  )
  assert.equal(
    isAllowedUpdateSimulationURL(
      'https://127.0.0.1:18991/latest.yml',
      feedURL,
    ),
    false,
  )
  assert.equal(
    isAllowedUpdateSimulationURL(
      'http://user@127.0.0.1:18991/latest.yml',
      feedURL,
    ),
    false,
  )
  assert.equal(
    isAllowedUpdateSimulationURL(
      'https://example.invalid/latest.yml',
      feedURL,
    ),
    false,
  )
  assert.equal(
    isAllowedUpdateSimulationURL(
      'wss://example.invalid/update-events',
      feedURL,
    ),
    false,
  )
})

test('更新模拟网络边界禁用代理并取消越界请求', async () => {
  const listenerHolder: { value?: (
    details: { url: string },
    callback: (response: { cancel?: boolean }) => void,
  ) => void } = {}
  const proxyConfigurations: Array<{ mode: 'direct' }> = []
  const blocked: string[] = []
  await installUpdateSimulationNetworkGuard({
    setProxy: async (configuration) => {
      proxyConfigurations.push(configuration)
    },
    webRequest: {
      onBeforeRequest: (_filter, nextListener) => {
        listenerHolder.value = nextListener
      },
    },
  }, {
    expectedFeedURL: feedURL,
    onBlocked: (url) => blocked.push(url),
  })

  assert.deepEqual(proxyConfigurations, [{ mode: 'direct' }])
  const installedListener = listenerHolder.value
  assert.ok(installedListener)
  let decision: { cancel?: boolean } | null = null
  installedListener(
    { url: 'https://example.invalid/escaped.yml' },
    (response: { cancel?: boolean }) => {
      decision = response
    },
  )
  assert.deepEqual(decision, { cancel: true })
  assert.deepEqual(blocked, ['https://example.invalid/escaped.yml'])
})
