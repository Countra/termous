import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { workerAcceptanceLaunchOptions } from './worker-acceptance-launch.mjs'

test('普通构建和 CI 标记不会隐式禁用 Worker sandbox', () => {
  for (const environment of [{}, { CI: 'true', GITHUB_ACTIONS: 'true' }, { TERMOUS_ELECTRON_ACCEPTANCE_NO_SANDBOX: '0' }]) {
    assert.deepEqual(workerAcceptanceLaunchOptions('/fixture', 'linux', environment).args, [])
  }
})

test('仅 Linux 的显式验收选项禁用 sandbox', () => {
  const environment = { TERMOUS_ELECTRON_ACCEPTANCE_NO_SANDBOX: '1' }
  assert.deepEqual(workerAcceptanceLaunchOptions('/fixture', 'linux', environment).args, ['--no-sandbox'])
  for (const platform of ['win32', 'darwin']) {
    assert.deepEqual(workerAcceptanceLaunchOptions('/fixture', platform, environment).args, [])
  }
})

test('验收进程保留 Xvfb 连接环境，隔离缓存且不继承令牌或控制选项', () => {
  const source = {
    PATH: '/tools', DISPLAY: ':99', XAUTHORITY: '/fixture/auth', XDG_RUNTIME_DIR: '/fixture/runtime',
    DBUS_SESSION_BUS_ADDRESS: 'unix:path=/fixture/bus', XDG_CACHE_HOME: '/host/cache',
    TERMOUS_ELECTRON_ACCEPTANCE_NO_SANDBOX: '1', TERMOUS_REPOSITORIES_READ_TOKEN: 'fixture-secret',
    NODE_OPTIONS: '--inspect', ELECTRON_RUN_AS_NODE: '1',
  }
  const { environment } = workerAcceptanceLaunchOptions('/fixture', 'linux', source)
  assert.deepEqual(environment, {
    PATH: source.PATH, DISPLAY: source.DISPLAY, XAUTHORITY: source.XAUTHORITY,
    XDG_RUNTIME_DIR: source.XDG_RUNTIME_DIR, DBUS_SESSION_BUS_ADDRESS: source.DBUS_SESSION_BUS_ADDRESS,
    XDG_CACHE_HOME: path.join('/fixture', 'cache'),
  })
  assert.equal(source.XDG_CACHE_HOME, '/host/cache')
})
