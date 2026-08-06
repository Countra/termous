import assert from 'node:assert/strict'
import test from 'node:test'
import type { PageKey } from '#shared/model'
import {
  hostLauncherActionPlan,
  hostLauncherIntentForPage,
  type HostLauncherIntent,
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

test('只有文件功能页默认使用文件启动场景', () => {
  const expectedIntents = {
    workbench: 'terminal',
    hosts: 'terminal',
    vault: 'terminal',
    files: 'files',
    forwards: 'terminal',
    snippets: 'terminal',
    settings: 'terminal',
  } satisfies Record<PageKey, HostLauncherIntent>
  for (const page of Object.keys(expectedIntents) as PageKey[]) {
    assert.equal(hostLauncherIntentForPage(page), expectedIntents[page])
  }
})
