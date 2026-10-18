import assert from 'node:assert/strict'
import test from 'node:test'

test('公共协议入口支持 Node 原生 ESM 加载', async () => {
  const contracts = await import('#common/contracts')
  assert.equal(contracts.appDebugModeArgument, '--termous-debug')
})
