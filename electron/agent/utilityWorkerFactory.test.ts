import assert from 'node:assert/strict'
import test from 'node:test'
import { sanitizedWorkerEnvironment } from './workerEnvironment.ts'

test('utilityProcess 环境只保留运行所需白名单', () => {
  const value = sanitizedWorkerEnvironment({
    PATH: 'bin',
    SystemRoot: 'windows',
    TEMP: 'temp',
    TERMOUS_API_TOKEN: 'secret',
    OPENAI_API_KEY: 'secret',
    NODE_OPTIONS: '--inspect',
  })

  assert.deepEqual(value, {
    PATH: 'bin',
    SystemRoot: 'windows',
    TEMP: 'temp',
  })
})
