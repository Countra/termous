import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveTerminalContextPath } from './terminalContextPath.ts'
import type { TerminalPathContextTarget } from './terminalContextTarget.ts'

test('绝对路径按远端 POSIX 规则规范化', () => {
  assert.equal(resolveTerminalContextPath(target('/var/log/../tmp', 'absolute')), '/var/tmp')
})

test('相对路径只使用可信的已确认目录解析', () => {
  const relative = target('../logs/app.log', 'cwd_relative')
  assert.equal(resolveTerminalContextPath(relative, '/opt/termous/current'), '/opt/termous/logs/app.log')
  assert.equal(resolveTerminalContextPath(relative), null)
  assert.equal(resolveTerminalContextPath(relative, 'relative/cwd'), null)
})

test('HOME 相对路径只能复制，不能猜测远端 HOME', () => {
  assert.equal(resolveTerminalContextPath(target('~/downloads', 'home_relative', true), '/root'), null)
})

function target(
  value: string,
  resolution: TerminalPathContextTarget['resolution'],
  copyOnly = false,
): TerminalPathContextTarget {
  return {
    kind: 'path',
    source: 'selection',
    value,
    resolution,
    requiresCwd: resolution === 'cwd_relative',
    copyOnly,
  }
}
