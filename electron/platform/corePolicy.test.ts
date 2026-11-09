import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { corePolicy } from './corePolicy.ts'

const baseEnv: NodeJS.ProcessEnv = { NODE_ENV: 'development', VITE_DEV_SERVER_URL: '', APP_ROOT: 'web', VITE_PUBLIC: 'public' }

test('正式版忽略开发 Core 地址和路径，但保留用户明确配置的数据目录', () => {
  const executable = path.resolve('fixture/Termous.exe')
  const environment: NodeJS.ProcessEnv = { ...baseEnv, NODE_ENV: 'development', VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173', TERMOUS_API_BASE_URL: 'http://127.0.0.1:8122', TERMOUS_CORE_PATH: 'other.exe', TERMOUS_DATA_DIR: 'custom-data' }
  const policy = corePolicy('production', environment, 'win32', executable, 'fixture')
  assert.equal(policy.external, false)
  assert.equal(policy.port, 8152)
  assert.equal(policy.binary, path.join(path.dirname(executable), 'termous-core.exe'))
  assert.equal(policy.apiBaseUrl, '')
  assert.equal(policy.apiToken, '')
  assert.equal(policy.environment.TERMOUS_DATA_DIR, 'custom-data')
})

test('开发壳默认连接外部 Core，仅显式 Core 路径启用开发托管', () => {
  const external = corePolicy('development', baseEnv, 'win32', 'shell.exe', path.resolve('web'))
  assert.equal(external.external, true)
  assert.equal(external.apiBaseUrl, 'http://127.0.0.1:8122')
  assert.equal(external.environment.TERMOUS_DATA_DIR, path.resolve('dev-data/.termous'))
  const managed = corePolicy('development', { ...baseEnv, TERMOUS_CORE_PATH: 'fixture.exe' }, 'win32', 'shell.exe', 'web')
  assert.equal(managed.external, false)
  assert.equal(managed.binary, 'fixture.exe')
})
