import assert from 'node:assert/strict'
import test from 'node:test'
import {
  hostLauncherActionPlan,
} from './hostLauncherIntent.ts'

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

test('远程桌面启动场景提供桌面主动作和相邻访问方式快捷入口', () => {
  assert.deepEqual(hostLauncherActionPlan('remote_desktop'), {
    primary: 'openRemoteDesktop',
    shortcuts: ['editHost', 'connect', 'openFiles'],
  })
})
