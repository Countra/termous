import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Windows 旧入口在本地和 CI 使用同一工具链', async () => {
  const source = await readFile(new URL('./build-windows.ps1', import.meta.url), 'utf8')
  assert.match(source, /build.py/)
  assert.match(source, /TERMOUS_BUILD_CONFIG/)
  assert.match(source, /TERMOUS_BUILD_PHASE/)
  assert.doesNotMatch(source, /GITHUB_ACTIONS|go build|go test|GOCACHE|electron-builder/)
})
