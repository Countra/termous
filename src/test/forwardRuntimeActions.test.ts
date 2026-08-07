import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

test('独立页和工作站复用同一端口转发实例操作组件', () => {
  const page = readSource('features', 'forwards', 'ui', 'ForwardManagementWorkspace.tsx')
  const sessionPanel = readSource('features', 'forwards', 'ui', 'ForwardSessionPanel.tsx')
  const actions = readSource('features', 'forwards', 'ui', 'ForwardRuntimeActions.tsx')

  assert.match(page, /<ForwardRuntimeActions/)
  assert.match(sessionPanel, /<ForwardRuntimeActions/)
  assert.match(actions, /loading=\{pendingAction === 'restart'\}/)
  assert.match(actions, /loading=\{pendingAction === 'stop'\}/)
  assert.match(actions, /role="group"/)
  assert.match(actions, /forward-runtime-action is-restart/)
  assert.match(actions, /forward-runtime-action is-stop/)
})

test('运行实例操作组使用稳定尺寸且按钮交互不会产生位移', () => {
  const styles = readSource('features', 'forwards', 'ui', 'ForwardManagement.module.scss')

  assert.match(styles, /\.forward-runtime-actions\s*\{[\s\S]*grid-template-columns:\s*28px 1px 28px/)
  assert.match(styles, /\.forward-runtime-action\.ant-btn\s*\{[\s\S]*width:\s*28px/)
  assert.match(styles, /\.forward-runtime-action\.ant-btn:not\(:disabled\):hover,[\s\S]*transform:\s*none/)
  assert.match(styles, /\.forward-runtime-action\.is-stop\.ant-btn:not\(:disabled\):hover/)
})

test('重启完成提示等待替代实例进入最终运行状态', () => {
  const app = readSource('app', 'main', 'App.tsx')
  const data = [
    readSource('app', 'data-runtime', 'useTermousData.ts'),
    readSource('app', 'data-runtime', 'model', 'forwardRuntimeState.ts'),
  ].join('\n')

  assert.match(app, /restart\.completion\.then/)
  assert.match(app, /isForwardRestartCompleted\(forward\)/)
  assert.doesNotMatch(
    app,
    /runAction\(\(\) => actions\.restartForward\(id\), t\('forwards\.restartCompleted'\)\)/,
  )
  assert.match(data, /selectForwardStartSnapshot/)
  assert.match(data, /if \(settledForward !== undefined\)/)
  assert.match(data, /rememberForwardEventSnapshot/)
  assert.match(data, /reconcileForwardStartCompletions/)
  assert.match(data, /FORWARD_START_COMPLETION_TIMEOUT_MS/)
  assert.match(
    data,
    /if \(forwardStartCompletionWaitersRef\.current\.has\(event\.forward\.id\)\)/,
  )
  assert.match(
    data,
    /const forward = await api\.getForward\(id\)\s+if \(!isCompletionPending\(\)\) \{\s+return undefined/,
  )
  assert.match(
    data,
    /catch \(syncError\) \{\s+if \(!isCompletionPending\(\)\) \{\s+return undefined/,
  )
  assert.match(data, /revisions\.delete\(forwardId\)/)
  assert.doesNotMatch(
    data,
    /同步端口转发启动终态失败[\s\S]{0,120}resolveForwardStartCompletion\(forward\.id, null\)/,
  )
})

function readSource(...segments: string[]) {
  return readFileSync(join(sourceRoot, ...segments), 'utf8')
}
