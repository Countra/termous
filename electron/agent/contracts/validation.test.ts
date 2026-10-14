import assert from 'node:assert/strict'
import test from 'node:test'
import { isRecord, validClientRequestID, validOpaqueIdentifier, validRunID } from './validation.ts'

test('共享对象校验保留合同对数组、空值和无原型对象的判断', () => {
  for (const value of [{}, Object.create(null), { field: undefined }]) assert.equal(isRecord(value), true)
  for (const value of [null, undefined, [], [1], '', 1, true, () => ({})]) assert.equal(isRecord(value), false)
})

test('运行、请求和资源标识共同保留长度及协议字符边界', () => {
  for (const validate of [validRunID, validClientRequestID, validOpaqueIdentifier]) {
    for (const value of ['a', 'run_A-9', 'x'.repeat(128)]) assert.equal(validate(value), true)
    for (const value of ['', 'x'.repeat(129), '含中文', ' leading', 'trailing ', '../target', 'line\n', null, 42]) {
      assert.equal(validate(value), false)
    }
  }
})
