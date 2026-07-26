import assert from 'node:assert/strict'
import test from 'node:test'
import {
  hostLauncherActionPlan,
  hostLauncherIntentForPage,
} from '../features/workbench/hostLauncherIntent.ts'

test('终端启动场景以 SSH 连接为主动作', () => {
  assert.deepEqual(hostLauncherActionPlan('terminal'), {
    primary: 'connect',
    shortcuts: ['editHost', 'openFiles', 'openForward'],
  })
})

test('文件启动场景将文件管理提升为主动作', () => {
  assert.deepEqual(hostLauncherActionPlan('files'), {
    primary: 'openFiles',
    shortcuts: ['editHost', 'connect', 'openForward'],
  })
})

test('只有文件功能页默认使用文件启动场景', () => {
  assert.equal(hostLauncherIntentForPage('files'), 'files')
  assert.equal(hostLauncherIntentForPage('workbench'), 'terminal')
  assert.equal(hostLauncherIntentForPage('hosts'), 'terminal')
})
