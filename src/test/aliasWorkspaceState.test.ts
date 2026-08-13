import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import type { AliasWorkspace, ShellAlias } from '../entities/alias/index.ts'
import {
  aliasPanelControlScope,
  aliasSessionViewReducer,
  buildShellAliasPatch,
  filterShellAliases,
  isCurrentAliasOperation,
  parseAliasReconnectSessionIds,
  retainAliasSessionStates,
  serializeAliasReconnectSessionIds,
  shellAliasTone,
  type AliasSessionViewStates,
} from '../features/alias/model/aliasWorkspaceState.ts'

test('别名搜索同时匹配名称、命令和说明且忽略大小写', () => {
  const items = [
    createAlias({ id: 'one', name: 'LL', command: 'ls -alF', description: '列出文件' }),
    createAlias({ id: 'two', name: 'serve', command: 'python -m http.server', description: 'LOCAL WEB' }),
  ]

  assert.deepEqual(filterShellAliases(items, 'll').map((item) => item.id), ['one'])
  assert.deepEqual(filterShellAliases(items, 'PYTHON').map((item) => item.id), ['two'])
  assert.deepEqual(filterShellAliases(items, 'local web').map((item) => item.id), ['two'])
  assert.equal(filterShellAliases(items, '  '), items)
})

test('列表状态只区分启用和停用', () => {
  assert.equal(shellAliasTone(createAlias()), 'ready')
  assert.equal(shellAliasTone(createAlias({ enabled: false })), 'muted')
})

test('编辑别名仅提交真实变化字段且保留命令空白', () => {
  const current = createAlias({
    command: '  printf "ok"  ',
    description: '说明',
  })
  assert.deepEqual(buildShellAliasPatch(current, {
    name: current.name,
    command: current.command,
    description: current.description ?? '',
    enabled: current.enabled,
  }), {})

  assert.deepEqual(buildShellAliasPatch(current, {
    name: current.name,
    command: ' printf "next" ',
    description: current.description ?? '',
    enabled: current.enabled,
  }), { command: ' printf "next" ' })
})

test('重连要求在当前会话生命周期内不会被普通刷新覆盖', () => {
  let states = aliasSessionViewReducer({}, {
    type: 'mutation-start',
    sessionId: 'session-1',
    sequence: 1,
    mutation: 'create',
    aliasId: '',
  })
  states = aliasSessionViewReducer(states, {
    type: 'mutation-success',
    sessionId: 'session-1',
    sequence: 1,
    workspace: createWorkspace(),
    applyStatus: 'reconnect_required',
  })
  assert.equal(states['session-1'].reconnectRequired, true)

  states = aliasSessionViewReducer(states, {
    type: 'load-start',
    sessionId: 'session-1',
    sequence: 2,
    quiet: true,
  })
  states = aliasSessionViewReducer(states, {
    type: 'load-success',
    sessionId: 'session-1',
    sequence: 2,
    workspace: createWorkspace({ bridge_status: 'installed' }),
    loadedAt: 2,
  })
  assert.equal(states['session-1'].reconnectRequired, true)

  states = aliasSessionViewReducer(states, {
    type: 'mutation-start',
    sessionId: 'session-1',
    sequence: 3,
    mutation: 'update',
    aliasId: 'alias-1',
  })
  states = aliasSessionViewReducer(states, {
    type: 'mutation-success',
    sessionId: 'session-1',
    sequence: 3,
    workspace: createWorkspace({ bridge_status: 'installed' }),
    applyStatus: 'next_prompt',
  })
  assert.equal(states['session-1'].reconnectRequired, true)
  assert.equal(states['session-2'], undefined)
})

test('重连会话缓存拒绝损坏数据并稳定去重和限制长度', () => {
  assert.deepEqual(parseAliasReconnectSessionIds(null), [])
  assert.deepEqual(parseAliasReconnectSessionIds('{invalid'), [])
  assert.deepEqual(parseAliasReconnectSessionIds('{"session":"one"}'), [])
  assert.deepEqual(
    parseAliasReconnectSessionIds(JSON.stringify([
      'session-one',
      'session-one',
      '',
      42,
      'x'.repeat(257),
      'session-two',
    ])),
    ['session-one', 'session-two'],
  )
  assert.equal(
    serializeAliasReconnectSessionIds(['session-two', 'session-two', 'session-one']),
    '["session-two","session-one"]',
  )
})

test('立即应用状态不会凭空要求重连', () => {
  let states = aliasSessionViewReducer({}, {
    type: 'mutation-start',
    sessionId: 'session-1',
    sequence: 1,
    mutation: 'update',
    aliasId: 'alias-1',
  })
  states = aliasSessionViewReducer(states, {
    type: 'mutation-success',
    sessionId: 'session-1',
    sequence: 1,
    workspace: createWorkspace({ bridge_status: 'installed' }),
    applyStatus: 'applied',
  })

  assert.equal(states['session-1'].reconnectRequired, false)
})

test('只读加载不会把缺少桥接错误解释为重新连接即可修复', () => {
  let states = aliasSessionViewReducer({}, {
    type: 'load-start',
    sessionId: 'session-1',
    sequence: 1,
    quiet: false,
  })
  states = aliasSessionViewReducer(states, {
    type: 'load-success',
    sessionId: 'session-1',
    sequence: 1,
    workspace: createWorkspace({ bridge_status: 'missing' }),
    loadedAt: 1,
  })
  assert.equal(states['session-1'].reconnectRequired, false)

  states = aliasSessionViewReducer({}, {
    type: 'load-start',
    sessionId: 'session-2',
    sequence: 1,
    quiet: false,
  })
  states = aliasSessionViewReducer(states, {
    type: 'load-success',
    sessionId: 'session-2',
    sequence: 1,
    workspace: createWorkspace({
      bridge_status: 'missing',
      items: [],
    }),
    loadedAt: 1,
  })
  assert.equal(states['session-2'].reconnectRequired, false)
})

test('退役请求使迟到结果失效并保留已有缓存', () => {
  const cached = createWorkspace()
  let states = aliasSessionViewReducer({}, {
    type: 'load-start',
    sessionId: 'session-1',
    sequence: 1,
    quiet: false,
  })
  states = aliasSessionViewReducer(states, {
    type: 'load-success',
    sessionId: 'session-1',
    sequence: 1,
    workspace: cached,
    loadedAt: 1,
  })
  states = aliasSessionViewReducer(states, {
    type: 'load-start',
    sessionId: 'session-1',
    sequence: 2,
    quiet: true,
  })
  states = aliasSessionViewReducer(states, {
    type: 'retire',
    sessionId: 'session-1',
    sequence: 3,
  })
  const retired = states
  states = aliasSessionViewReducer(states, {
    type: 'load-success',
    sessionId: 'session-1',
    sequence: 2,
    workspace: createWorkspace({ shell: 'zsh' }),
    loadedAt: 2,
  })

  assert.equal(states, retired)
  assert.equal(states['session-1'].workspace, cached)
  assert.equal(states['session-1'].refreshing, false)
})

test('旧模板错误保留缓存且始终提供更新配置入口', () => {
  const cached = createWorkspace()
  let states = aliasSessionViewReducer({}, {
    type: 'load-start',
    sessionId: 'session-1',
    sequence: 1,
    quiet: false,
  })
  states = aliasSessionViewReducer(states, {
    type: 'load-success',
    sessionId: 'session-1',
    sequence: 1,
    workspace: cached,
    loadedAt: 1,
  })
  states = aliasSessionViewReducer(states, {
    type: 'load-start',
    sessionId: 'session-1',
    sequence: 2,
    quiet: true,
  })
  states = aliasSessionViewReducer(states, {
    type: 'load-error',
    sessionId: 'session-1',
    sequence: 2,
    errorCode: 'SHELL_ALIAS_TEMPLATE_OUTDATED',
    errorMessage: '配置需要更新',
  })

  assert.equal(states['session-1'].workspace, cached)
  assert.equal(states['session-1'].templateOutdated, true)
  assert.equal(states['session-1'].errorCode, 'SHELL_ALIAS_TEMPLATE_OUTDATED')

  states = aliasSessionViewReducer(states, {
    type: 'load-start',
    sessionId: 'session-1',
    sequence: 3,
    quiet: true,
  })
  assert.equal(states['session-1'].templateOutdated, true)

  states = aliasSessionViewReducer(states, {
    type: 'load-error',
    sessionId: 'session-1',
    sequence: 3,
    errorCode: 'SHELL_ALIAS_TIMEOUT',
    errorMessage: '更新检查超时',
  })
  assert.equal(states['session-1'].templateOutdated, true)

  states = aliasSessionViewReducer(states, {
    type: 'mutation-start',
    sessionId: 'session-1',
    sequence: 4,
    mutation: 'refresh-template',
    aliasId: '',
  })
  states = aliasSessionViewReducer(states, {
    type: 'mutation-error',
    sessionId: 'session-1',
    sequence: 4,
    errorCode: 'SHELL_ALIAS_TIMEOUT',
    errorMessage: '更新配置超时',
  })
  assert.equal(states['session-1'].templateOutdated, true)

  states = aliasSessionViewReducer(states, {
    type: 'mutation-start',
    sessionId: 'session-1',
    sequence: 5,
    mutation: 'refresh-template',
    aliasId: '',
  })
  states = aliasSessionViewReducer(states, {
    type: 'mutation-success',
    sessionId: 'session-1',
    sequence: 5,
    workspace: cached,
    applyStatus: 'next_prompt',
  })
  assert.equal(states['session-1'].templateOutdated, false)

  states = aliasSessionViewReducer(states, {
    type: 'load-start',
    sessionId: 'session-1',
    sequence: 6,
    quiet: true,
  })
  states = aliasSessionViewReducer(states, {
    type: 'load-error',
    sessionId: 'session-1',
    sequence: 6,
    errorCode: 'SHELL_ALIAS_TEMPLATE_OUTDATED',
    errorMessage: '配置需要更新',
  })
  states = aliasSessionViewReducer(states, {
    type: 'load-start',
    sessionId: 'session-1',
    sequence: 7,
    quiet: true,
  })
  states = aliasSessionViewReducer(states, {
    type: 'load-error',
    sessionId: 'session-1',
    sequence: 7,
    errorCode: 'SHELL_ALIAS_FILE_CONFLICT',
    errorMessage: '远端配置已变为不可安全更新的冲突文件',
  })
  assert.equal(states['session-1'].templateOutdated, false)
})

test('会话切换保留各自缓存且互不覆盖', () => {
  let states = aliasSessionViewReducer({}, {
    type: 'load-start',
    sessionId: 'session-a',
    sequence: 1,
    quiet: false,
  })
  states = aliasSessionViewReducer(states, {
    type: 'load-success',
    sessionId: 'session-a',
    sequence: 1,
    workspace: createWorkspace({ shell: 'bash' }),
    loadedAt: 1,
  })
  states = aliasSessionViewReducer(states, {
    type: 'load-start',
    sessionId: 'session-b',
    sequence: 1,
    quiet: false,
  })
  states = aliasSessionViewReducer(states, {
    type: 'load-success',
    sessionId: 'session-b',
    sequence: 1,
    workspace: createWorkspace({ shell: 'fish' }),
    loadedAt: 2,
  })

  assert.equal(states['session-a'].workspace?.shell, 'bash')
  assert.equal(states['session-b'].workspace?.shell, 'fish')
})

test('别名缓存按仍存活的 SSH 会话清理且不淘汰有效重连状态', () => {
  let states: AliasSessionViewStates = {}
  for (let index = 0; index < 30; index += 1) {
    const sessionId = `session-${index}`
    states = aliasSessionViewReducer(states, {
      type: 'load-start',
      sessionId,
      sequence: 1,
      quiet: false,
    })
    states = aliasSessionViewReducer(states, {
      type: 'load-success',
      sessionId,
      sequence: 1,
      workspace: createWorkspace(),
      loadedAt: index + 1,
    })
  }

  const retained = retainAliasSessionStates(
    states,
    new Set(['session-0', 'session-29']),
  )
  assert.deepEqual(Object.keys(retained).sort(), ['session-0', 'session-29'])
  assert.equal(retained['session-0']?.lastLoadedAt, 1)
  assert.equal(retained['session-29']?.lastLoadedAt, 30)
})

test('异步操作只允许自身身份清理', () => {
  const first = { id: 'first' }
  const replacement = { id: 'replacement' }
  assert.equal(isCurrentAliasOperation(first, first), true)
  assert.equal(isCurrentAliasOperation(replacement, first), false)
  assert.equal(isCurrentAliasOperation(null, first), false)
})

test('工作台在端口转发之后、代码片段之前注册别名页签', () => {
  const detailsSource = readFileSync(
    fileURLToPath(new URL('../widgets/workbench/ui/WorkbenchDetailsPanel.tsx', import.meta.url)),
    'utf8',
  )
  const detailsModelSource = readFileSync(
    fileURLToPath(new URL('../widgets/workbench/model/workbenchDetails.ts', import.meta.url)),
    'utf8',
  )
  const forwards = detailsSource.indexOf("key: 'forwards'")
  const aliases = detailsSource.indexOf("key: 'aliases'")
  const snippets = detailsSource.indexOf("key: 'snippets'")

  assert.ok(forwards >= 0)
  assert.ok(aliases > forwards)
  assert.ok(snippets > aliases)
  assert.match(detailsModelSource, /value === 'aliases'/)
})

test('Alias API 不再发送 ETag、If-Match 或 apply 请求', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../app/data-runtime/api/gateways/aliasClient.ts', import.meta.url)),
    'utf8',
  )

  assert.doesNotMatch(source, /requestWithMetadata/)
  assert.doesNotMatch(source, /If-Match/)
  assert.doesNotMatch(source, /applySessionAliases/)
  assert.match(source, /createSessionAlias[\s\S]*this\.request<AliasMutationResult>/)
  assert.match(
    source,
    /repairSessionAliasBridge[\s\S]*aliases\/bridge\/repair[\s\S]*method: 'POST'/,
  )
  assert.match(
    source,
    /refreshSessionAliasTemplate[\s\S]*aliases\/template\/refresh[\s\S]*method: 'POST'/,
  )
})

test('Alias 面板不依赖目录跟随运行态或外部冲突流程', () => {
  const panel = readFileSync(
    fileURLToPath(new URL('../features/alias/ui/AliasPanel.tsx', import.meta.url)),
    'utf8',
  )
  const helpers = readFileSync(
    fileURLToPath(new URL('../features/alias/ui/aliasPanelHelpers.ts', import.meta.url)),
    'utf8',
  )
  const hook = readFileSync(
    fileURLToPath(new URL('../features/alias/model/useSessionAliases.ts', import.meta.url)),
    'utf8',
  )
  const cwdRuntime = readFileSync(
    fileURLToPath(new URL('../features/terminal/model/terminalCwdRuntime.ts', import.meta.url)),
    'utf8',
  )

  assert.doesNotMatch(panel, /useSessionCwdState/)
  assert.doesNotMatch(panel, /override_external/)
  assert.doesNotMatch(panel, /SHELL_ALIAS_EXTERNAL_CONFLICT/)
  assert.doesNotMatch(hook, /etag|revision|activation|setInterval/i)
  assert.doesNotMatch(hook, /mutationRequestRef\.current\?\.controller\.abort/)
  assert.match(hook, /mutationRequestsRef\.current\.has\(sessionId\)/)
  assert.match(panel, /aliases\.repairBridge\(\)/)
  assert.match(panel, /aliases\.templateOutdated/)
  assert.match(panel, /aliases\.refreshTemplate\(\)/)
  assert.match(panel, /workbench\.aliases\.templateRefreshAction/)
  assert.match(
    panel,
    /if \(aliases\.templateOutdated \|\| aliases\.mutation === 'refresh-template'\)/,
  )
  assert.match(
    helpers,
    /SHELL_ALIAS_FILE_CONFLICT: 'workbench\.aliases\.errors\.fileConflict'/,
  )
  assert.doesNotMatch(
    panel,
    /repairAliasBridge[\s\S]*updateAlias\([\s\S]*enabled:/,
  )
  assert.doesNotMatch(cwdRuntime, /aliases_revision|active_shell_epoch/)
})

test('别名表单控件使用会话隔离的稳定 ID 与标签关联', () => {
  assert.equal(aliasPanelControlScope('ses_abc/next'), 'workbench-alias-ses_abc%2Fnext')
  assert.equal(aliasPanelControlScope(undefined), 'workbench-alias-inactive')

  const editor = readFileSync(
    fileURLToPath(new URL('../features/alias/ui/AliasEditorView.tsx', import.meta.url)),
    'utf8',
  )
  for (const field of ['name', 'command', 'description']) {
    const expression = '`${controlScope}-' + field + '`'
    assert.ok(editor.includes(`htmlFor={${expression}}`))
    assert.ok(editor.includes(`id={${expression}}`))
    assert.ok(editor.includes(`name={${expression}}`))
  }
  assert.match(editor, /onFinish=\{onSave\}/)
  assert.match(editor, /htmlType="submit"/)
  assert.match(editor, /scrollToFirstError=\{\{ block: 'nearest', focus: true \}\}/)
})

test('重连使用同步门控且行操作包含具体别名的无障碍名称', () => {
  const panel = readFileSync(
    fileURLToPath(new URL('../features/alias/ui/AliasPanel.tsx', import.meta.url)),
    'utf8',
  )
  const parts = readFileSync(
    fileURLToPath(new URL('../features/alias/ui/AliasPanelParts.tsx', import.meta.url)),
    'utf8',
  )

  assert.match(panel, /reconnectingRef\.current/)
  assert.match(panel, /form\.resetFields\(\)[\s\S]*form\.setFieldsValue\(editorValues\)/)
  assert.match(panel, /aria-busy=\{aliases\.refreshing \|\| Boolean\(aliases\.mutation\)\}/)
  assert.match(parts, /workbench\.aliases\.editAlias/)
  assert.match(parts, /workbench\.aliases\.deleteAlias/)
  assert.match(parts, /workbench\.aliases\.enableAlias/)
  assert.match(parts, /workbench\.aliases\.disableAlias/)
  assert.match(parts, /open=\{deleteConfirmOpen\}/)
  assert.match(parts, /onOpenChange=\{onDeleteConfirmOpenChange\}/)
})

test('重连要求使用会话级存储恢复并按存活会话清理', () => {
  const hook = readFileSync(
    fileURLToPath(new URL('../features/alias/model/useSessionAliases.ts', import.meta.url)),
    'utf8',
  )

  assert.match(hook, /termous\.runtime\.aliasReconnectRequired/)
  assert.match(hook, /result\.apply_status === 'reconnect_required'/)
  assert.match(hook, /rememberAliasReconnectSessionId\(sessionId\)/)
  assert.ok(
    (hook.match(/retainAliasReconnectSessionIds\(retainedSessionIds\)/g) ?? []).length >= 2,
  )
  assert.match(hook, /window\.sessionStorage\.getItem/)
  assert.match(hook, /window\.sessionStorage\.setItem/)
})

function createAlias(patch: Partial<ShellAlias> = {}): ShellAlias {
  return {
    id: 'alias-1',
    name: 'll',
    command: 'ls -alF',
    description: '',
    enabled: true,
    created_at: '2026-07-28T00:00:00Z',
    updated_at: '2026-07-28T00:00:00Z',
    ...patch,
  }
}

function createWorkspace(patch: Partial<AliasWorkspace> = {}): AliasWorkspace {
  return {
    shell: 'bash',
    bridge_status: 'installed',
    items: [createAlias()],
    ...patch,
  }
}
