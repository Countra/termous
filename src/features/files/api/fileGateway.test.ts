import assert from 'node:assert/strict'
import test from 'node:test'
import type { TermousApi } from '#app/data-runtime'
import type { FileGateway } from './fileGateway.ts'

test('TermousApi 保持文件网关合同兼容', () => {
  const compatible: TermousApi extends FileGateway ? true : false = true

  assert.equal(compatible, true)
})
