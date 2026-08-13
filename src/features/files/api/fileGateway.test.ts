import assert from 'node:assert/strict'
import test from 'node:test'
import type { RuntimeGateways } from '#app/data-runtime'
import type { FileGateway } from './fileGateway.ts'

test('文件领域组合保持文件网关合同兼容', () => {
  const compatible: RuntimeGateways['files'] extends FileGateway ? true : false = true

  assert.equal(compatible, true)
})
