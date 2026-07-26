import assert from 'node:assert/strict'
import test from 'node:test'
import {
  InvalidRemotePosixPathError,
  normalizeRemotePosixPath,
  requireRemotePosixPath,
} from '../shared/remotePosixPath.ts'
import { joinPath, normalizeRemotePath } from '../features/files/fileUtils.ts'

test('共享 POSIX 规范化只折叠空段、点段和父目录段', () => {
  assert.equal(normalizeRemotePosixPath('/root//./a/../b/'), '/root/b')
  assert.equal(normalizeRemotePosixPath('/../../'), '/')
  assert.equal(normalizeRemotePosixPath('/'), '/')
})

test('共享 POSIX 规范化保留路径段空格和反斜杠', () => {
  assert.equal(normalizeRemotePosixPath('/ root / child '), '/ root / child ')
  assert.equal(normalizeRemotePosixPath('/root/a\\b'), '/root/a\\b')
  assert.equal(normalizeRemotePosixPath('/root/ . /.. '), '/root/ . /.. ')
  assert.equal(joinPath('/root', 'a\\b '), '/root/a\\b ')
})

test('共享 POSIX 规范化拒绝相对路径、控制字符和非法 Unicode', () => {
  assert.equal(normalizeRemotePosixPath('root'), null)
  assert.equal(normalizeRemotePosixPath('/root\u0000bad'), null)
  assert.equal(normalizeRemotePosixPath('/root\u0085bad'), null)
  assert.equal(normalizeRemotePosixPath('/root/\ud800bad'), null)
  assert.equal(normalizeRemotePosixPath('/root/\udc00bad'), null)
  assert.equal(normalizeRemotePosixPath('/root/😀'), '/root/😀')
  assert.throws(() => requireRemotePosixPath('root'), InvalidRemotePosixPathError)
  assert.throws(() => normalizeRemotePath('/root\u0000bad'), InvalidRemotePosixPathError)
})
