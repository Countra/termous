import assert from 'node:assert/strict'
import test from 'node:test'
import { termousReleasePageUrl } from './index.ts'

test('当前版本 Release 地址规范化版本前缀并编码路径分隔符', () => {
  assert.equal(termousReleasePageUrl(null), null)
  assert.equal(termousReleasePageUrl('  '), null)
  assert.equal(
    termousReleasePageUrl('v1.2.3-beta.1+7'),
    'https://github.com/Countra/termous/releases/tag/v1.2.3-beta.1%2B7',
  )
  assert.equal(
    termousReleasePageUrl('1.2.3/other'),
    'https://github.com/Countra/termous/releases/tag/v1.2.3%2Fother',
  )
})
