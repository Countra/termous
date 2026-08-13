import assert from 'node:assert/strict'
import test from 'node:test'
import {
  InvalidRemotePosixPathError,
  joinPath,
  normalizeRemotePath,
  normalizeRemotePosixPath,
  parentPath,
  pathBase,
  requireRemotePosixPath,
} from '#shared/path'

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

test('共享远端路径组合保持根目录和末级名称语义', () => {
  assert.equal(joinPath('/', '/root/file.txt'), '/root/file.txt')
  assert.equal(parentPath('/root/file.txt'), '/root')
  assert.equal(parentPath('/'), '/')
  assert.equal(pathBase('/root/file.txt'), 'file.txt')
  assert.equal(pathBase('/'), '/')
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
