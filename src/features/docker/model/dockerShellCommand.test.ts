import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDockerShellCommand } from './dockerShellCommand.ts'

const id = 'a1'.repeat(32)

test('容器 Shell 使用完整 ID，通过单次 docker exec 在容器内选择 Bash 或 sh', () => {
  assert.equal(buildDockerShellCommand({ id, state: 'running' }),
    `docker exec -it '${id}' sh -c 'if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi'`)
})

test('不为停止的容器、短 ID、名称或包含 Shell 语法的引用生成命令', () => {
  for (const state of ['paused', 'exited', 'created', 'restarting', 'dead', 'removing', 'unknown']) {
    assert.equal(buildDockerShellCommand({ id, state }), null)
  }
  for (const value of ['', 'web', id.slice(0, 12), `--${id}`, `${id}\n`, `${id};id`, "'; touch /tmp/test; '", '$(id)', id + '\x1b']) {
    assert.equal(buildDockerShellCommand({ id: value, state: 'running' }), null)
  }
})
