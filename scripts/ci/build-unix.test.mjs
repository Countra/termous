import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Unix 旧入口只代理工具链，保留阶段与版本输入', async () => {
  const source = await readFile(new URL('./build-unix.sh', import.meta.url), 'utf8')
  assert.match(source, /build.py/)
  assert.match(source, /TERMOUS_BUILD_PHASE/)
  assert.match(source, /TERMOUS_VERSION/)
  assert.match(source, /Linux:x86_64/)
  assert.match(source, /Darwin:arm64/)
  assert.doesNotMatch(source, /Darwin:x86_64|go build|pnpm|GOCACHE|GOMODCACHE|GOTMPDIR|electron-builder/)
})
