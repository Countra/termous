import assert from 'node:assert/strict'
import test from 'node:test'
import {
  binaryStringToBytes,
  ensureTerminalEnter,
} from './terminalInput.ts'

test('二进制字符串逐字符保留低八位字节', () => {
  assert.deepEqual(
    binaryStringToBytes(`\u0000\u00ff\u0101\uffff`),
    new Uint8Array([0, 255, 1, 255]),
  )
})

test('执行文本只在末尾没有换行时补充终端回车', () => {
  assert.equal(ensureTerminalEnter('pwd'), 'pwd\r')
  assert.equal(ensureTerminalEnter('pwd\n'), 'pwd\n')
  assert.equal(ensureTerminalEnter('pwd\r\n'), 'pwd\r\n')
  assert.equal(ensureTerminalEnter('pwd\r'), 'pwd\r\r')
})
