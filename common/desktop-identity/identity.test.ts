import assert from 'node:assert/strict'
import test from 'node:test'
import { assertDesktopChannel, desktopIdentity } from './index.ts'
import { decodeAppBuildInfo } from '#common/contracts'

test('渠道只能使用构建身份，未知值及壳身份冲突被拒绝', () => {
  assert.notEqual(desktopIdentity('production').toastClsid, desktopIdentity('development').toastClsid)
  assert.equal(desktopIdentity('production').appId, 'com.termous.app')
  for (const channel of ['preview', undefined, 'webDebug']) assert.throws(() => desktopIdentity(channel))
  assert.throws(() => assertDesktopChannel('production', 'development'))
  assert.throws(() => assertDesktopChannel('development', undefined))
  assertDesktopChannel('production', 'production')
})

test('构建信息不能省略渠道，也不能使用打包状态推导渠道', () => {
  const info = { product_name: 'Termous Dev', version: '0.0.0', core_version: null, platform: 'win32', arch: 'x64', packaged: true, update_supported: false, update_support_reason: 'development' }
  assert.throws(() => decodeAppBuildInfo(info))
  assert.equal(decodeAppBuildInfo({ ...info, channel: 'development' }).channel, 'development')
})
