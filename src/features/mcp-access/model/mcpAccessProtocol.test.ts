import assert from 'node:assert/strict'
import test from 'node:test'
import { McpAccessProtocolError } from './protocol/base.ts'
import {
  decodeMcpApprovalDecisionResult,
  decodeMcpApprovalEvent,
  decodeMcpApprovalSnapshot,
  decodeMcpClientToken,
  decodeMcpClients,
  decodeMcpStatus,
} from './mcpAccessProtocol.ts'

test('MCP 管理协议解码 canonical 状态、客户端和一次性令牌', () => {
  const status = decodeMcpStatus(statusFixture())
  assert.equal(status.endpoint, 'http://127.0.0.1:18131/mcp')
  assert.equal(status.revision, 4)

  const clients = decodeMcpClients([clientFixture()])
  assert.equal(clients[0]?.host_access_mode, 'all_saved')
  assert.equal(clients[0]?.token_prefix, 'tmcp_abcd')
  assert.equal(clients[0]?.approval_bypass, false)

  const trustedClients = decodeMcpClients([{
    ...clientFixture(),
    approval_bypass: true,
  }])
  assert.equal(trustedClients[0]?.approval_bypass, true)

  const credential = decodeMcpClientToken({ client: clientFixture(), token: 'tmcp_secret' })
  assert.equal(credential.token, 'tmcp_secret')
  assert.equal(credential.client.revision, 7)
})

test('MCP 管理协议接受 Agent 托管投影并兼容旧 Core 与外部写响应', () => {
  const managed = decodeMcpClients([{
    ...clientFixture(),
    source: 'builtin_agent',
    read_only: true,
    token_prefix: '',
  }])[0]
  assert.equal(managed?.source, 'builtin_agent')
  assert.equal(managed?.read_only, true)
  assert.equal(managed?.token_prefix, '')

  const legacy = decodeMcpClients([{
    ...clientFixture(),
    source: undefined,
    read_only: undefined,
  }])[0]
  assert.equal(legacy?.source, 'external')
  assert.equal(legacy?.read_only, false)

  const externalWriteResponse = decodeMcpClients([{
    ...clientFixture(),
    read_only: undefined,
  }])[0]
  assert.equal(externalWriteResponse?.source, 'external')
  assert.equal(externalWriteResponse?.read_only, false)
})

test('MCP 文件权限仅接受新名称，存储兼容不能混入 HTTP 投影', () => {
  const scopes = ['files:read', 'files:connect', 'files:close', 'files:write', 'files:delete',
    'files:transfer', 'files:cancel', 'files:batch_rename', 'files:search']
  assert.deepEqual(decodeMcpClients([{ ...clientFixture(), scopes }])[0]?.scopes, scopes)
  for (const legacyScope of ['sftp:read', 'sftp:file_search', 'files:file_search']) {
    assert.throws(() => decodeMcpClients([{
      ...clientFixture(), scopes: ['files:read', legacyScope],
    }]), /未知权限/)
  }
})

test('MCP 文件审批拒绝旧领域名，避免跳过新审批范围校验', () => {
  const legacyApproval = {
    ...approvalFixture('pending'), kind: 'sftp', operation: { action: 'delete' },
  }
  assert.throws(() => decodeMcpApprovalSnapshot({
    instance_id: 'instance-1', revision: 1, items: [legacyApproval],
  }), /类型无效/)
})

test('MCP 管理协议拒绝客户端来源、只读状态与令牌投影不一致', () => {
  assert.throws(() => decodeMcpClients([{
    ...clientFixture(),
    read_only: true,
  }]), /不一致/)
  assert.throws(() => decodeMcpClients([{
    ...clientFixture(),
    source: 'builtin_agent',
    read_only: undefined,
    token_prefix: '',
  }]), /只读状态/)
  assert.throws(() => decodeMcpClients([{
    ...clientFixture(),
    source: 'builtin_agent',
    read_only: true,
  }]), /令牌投影/)
  assert.throws(() => decodeMcpClients([{
    ...clientFixture(),
    token_prefix: '',
  }]), /令牌标识/)
})

test('MCP 审批协议使用完整快照事件并保留调度冲突状态', () => {
  const snapshot = decodeMcpApprovalSnapshot(approvalSnapshotFixture('dispatch_conflict'))
  assert.equal(snapshot.items[0]?.state, 'dispatch_conflict')
  assert.equal(snapshot.items[0]?.targets[0]?.host_name, '测试主机')

  const event = decodeMcpApprovalEvent({
    type: 'mcp_approval_update',
    snapshot: approvalSnapshotFixture('pending'),
  })
  assert.equal(event.snapshot.revision, 12)
  assert.equal(event.snapshot.items[0]?.kind, 'command')
  assert.equal(event.snapshot.items[0]?.command, 'uname -s')

  const result = decodeMcpApprovalDecisionResult({
    approval: approvalFixture('dispatching'),
    task: { id: 'task-1' },
  })
  assert.equal(result.approval.state, 'dispatching')
})

test('MCP 审批协议解码文件管理操作摘要并容忍可选展示字段', () => {
  const snapshot = decodeMcpApprovalSnapshot({
    instance_id: 'instance-1',
    revision: 13,
    items: [{
      ...approvalFixture('pending'),
      kind: 'files',
      command: undefined,
      session_ids: undefined,
      targets: undefined,
      operation: {
        action: 'upload',
        file_session_id: 'file-session-1',
        host_name: '测试主机',
        local_paths: ['C:\\work\\release.zip'],
        remote_target: '/srv/releases',
        overwrite_policy: 'rename',
        item_count: 1,
        total_bytes: 2048,
        future_field: 'ignored',
      },
    }],
  })

  const approval = snapshot.items[0]
  assert.equal(approval?.kind, 'files')
  assert.equal(approval?.command, '')
  assert.deepEqual(approval?.session_ids, [])
  assert.deepEqual(approval?.targets, [])
  assert.deepEqual(approval?.operation?.remote_paths, [])
  assert.deepEqual(approval?.operation?.local_paths, ['C:\\work\\release.zip'])
  assert.deepEqual(approval?.operation?.rename_mappings, [])
  assert.equal(approval?.operation?.remote_target, '/srv/releases')
  assert.equal(approval?.operation?.total_bytes, 2048)
})

test('MCP 审批协议接受批量重命名映射数量上限', () => {
  const renameMappings = Array.from({ length: 500 }, (_, index) => ({
    source_name: `source-${index}`,
    target_name: `target-${index}`,
  }))
  const snapshot = decodeMcpApprovalSnapshot({
    instance_id: 'instance-1',
    revision: 14,
    items: [{
      ...approvalFixture('pending'),
      kind: 'files',
      operation: {
        action: 'batch_rename',
        item_count: 500,
        rule_count: 32,
        rename_mappings: renameMappings,
      },
    }],
  })

  assert.equal(snapshot.items[0]?.operation?.rename_mappings.length, 500)
  assert.equal(snapshot.items[0]?.operation?.rule_count, 32)
})

test('MCP 审批协议接受批量重命名终态清空敏感映射', () => {
  const snapshot = decodeMcpApprovalSnapshot({
    instance_id: 'instance-1',
    revision: 15,
    items: [{
      ...approvalFixture('approved'),
      kind: 'files',
      operation: {
        action: 'batch_rename',
        item_count: 2,
        rule_count: 1,
      },
    }],
  })

  assert.deepEqual(snapshot.items[0]?.operation?.rename_mappings, [])
})

test('MCP 审批协议解码文件管理批量重命名映射', () => {
  const snapshot = decodeMcpApprovalSnapshot({
    instance_id: 'instance-1',
    revision: 14,
    items: [{
      ...approvalFixture('pending'),
      kind: 'files',
      command: undefined,
      session_ids: undefined,
      targets: undefined,
      operation: {
        action: 'batch_rename',
        file_session_id: 'file-session-1',
        host_name: '测试主机',
        item_count: 2,
        rule_count: 3,
        rename_mappings: [
          { source_name: 'a.txt', target_name: 'release-a.txt' },
          { source_name: 'b.txt', target_name: 'release-b.txt' },
        ],
      },
    }],
  })

  const approval = snapshot.items[0]
  assert.equal(approval?.kind, 'files')
  assert.equal(approval?.operation?.rule_count, 3)
  assert.deepEqual(approval?.operation?.rename_mappings, [
    { source_name: 'a.txt', target_name: 'release-a.txt' },
    { source_name: 'b.txt', target_name: 'release-b.txt' },
  ])
})

test('MCP 审批协议解码远程运维操作并保留显式 false', () => {
  const snapshot = decodeMcpApprovalSnapshot({
    instance_id: 'instance-1',
    revision: 14,
    items: [{
      ...approvalFixture('pending'),
      kind: 'remoteops',
      command: undefined,
      operation: {
        domain: 'crontab',
        action: 'update',
        resource_id: 'job-1',
        resource_name: '备份任务',
        schedule: '0 2 * * *',
        command: '/usr/local/bin/backup --daily',
        enabled: false,
      },
    }],
  })

  const approval = snapshot.items[0]
  assert.equal(approval?.kind, 'remoteops')
  assert.equal(approval?.command, '')
  assert.equal(approval?.operation?.domain, 'crontab')
  assert.equal(approval?.operation?.enabled, false)
  assert.equal(approval?.operation?.command, '/usr/local/bin/backup --daily')
  assert.deepEqual(approval?.session_ids, ['session-1'])
  assert.equal(approval?.targets[0]?.host_name, '测试主机')
})

test('MCP 审批协议解码端口转发和代码片段操作摘要', () => {
  const snapshot = decodeMcpApprovalSnapshot({
    instance_id: 'instance-1',
    revision: 15,
    items: [
      {
        ...approvalFixture('pending'),
        kind: 'forwarding',
        command: undefined,
        session_ids: undefined,
        targets: undefined,
        operation: {
          action: 'start',
          resource_id: 'profile-1',
          resource_name: '数据库隧道',
          mode: 'local',
          lifecycle: 'background_profile',
          bind_address: '127.0.0.1:15432',
          target_address: 'db.internal:5432',
        },
      },
      {
        ...approvalFixture('pending'),
        kind: 'snippet',
        command: undefined,
        session_ids: undefined,
        targets: undefined,
        operation: {
          action: 'update',
          resource_id: 'snippet-1',
          resource_name: '查看端口',
          group_name: '诊断',
          shell: 'bash',
          description: '查看监听端口',
          tags: ['network', 'diagnostics'],
          command: 'ss -lntp',
        },
      },
    ],
  })

  const forwarding = snapshot.items[0]
  assert.equal(forwarding?.kind, 'forwarding')
  assert.deepEqual(forwarding?.session_ids, [])
  assert.equal(forwarding?.operation?.lifecycle, 'background_profile')
  assert.equal(forwarding?.operation?.bind_address, '127.0.0.1:15432')

  const snippet = snapshot.items[1]
  assert.equal(snippet?.kind, 'snippet')
  assert.deepEqual(snippet?.targets, [])
  assert.equal(snippet?.operation?.group_name, '诊断')
  assert.deepEqual(snippet?.operation?.tags, ['network', 'diagnostics'])
  assert.equal(snippet?.operation?.command, 'ss -lntp')
})

test('MCP 管理协议拒绝旧别名、未知权限和非 canonical 事件', () => {
  assert.throws(() => decodeMcpStatus({
    ...statusFixture(),
    endpoint: undefined,
    url: 'http://127.0.0.1:18131/mcp',
  }), /连接地址/)
  assert.throws(() => decodeMcpStatus({
    ...statusFixture(),
    protocol_version: '2025-03-26',
  }), /协议版本/)
  assert.throws(() => decodeMcpStatus({
    ...statusFixture(),
    enabled: false,
  }), /不一致/)
  assert.throws(() => decodeMcpClients([{
    ...clientFixture(),
    approval_bypass: 'yes',
  }]), /审批策略/)
  assert.throws(() => decodeMcpClients([{ ...clientFixture(), scopes: ['hosts:admin'] }]), /未知权限/)
  assert.throws(() => decodeMcpApprovalSnapshot({
    instance_id: 'instance-1',
    revision: 12,
    approvals: [approvalFixture('pending')],
  }), /审批列表/)
  assert.throws(() => decodeMcpApprovalEvent({
    type: 'snapshot',
    snapshot: approvalSnapshotFixture('pending'),
  }), /事件类型/)
  assert.throws(() => decodeMcpApprovalSnapshot({
    instance_id: 'instance-1',
    revision: 12,
    items: [{
      ...approvalFixture('pending'),
      kind: 'files',
      operation: { action: 'download', overwrite_policy: 'ask' },
    }],
  }), /冲突策略/)
  assert.throws(() => decodeMcpApprovalSnapshot({
    instance_id: 'instance-1',
    revision: 12,
    items: [{
      ...approvalFixture('pending'),
      kind: 'remoteops',
      operation: undefined,
    }],
  }), /远程运维审批操作缺失/)
  assert.throws(() => decodeMcpApprovalSnapshot({
    instance_id: 'instance-1',
    revision: 12,
    items: [{
      ...approvalFixture('pending'),
      kind: 'remoteops',
      operation: { action: 'update', enabled: 'false' },
    }],
  }), /审批领域缺失/)
  assert.throws(() => decodeMcpApprovalSnapshot({
    instance_id: 'instance-1',
    revision: 12,
    items: [{
      ...approvalFixture('pending'),
      kind: 'remoteops',
      operation: { domain: 'crontab', action: 'update', enabled: 'false' },
    }],
  }), /启用状态无效/)
  assert.throws(() => decodeMcpApprovalSnapshot({
    instance_id: 'instance-1',
    revision: 12,
    items: [{
      ...approvalFixture('pending'),
      kind: 'snippet',
      operation: { action: 'update', tags: ['valid', 1] },
    }],
  }), /标签无效/)
  assert.throws(() => decodeMcpApprovalSnapshot({
    instance_id: 'instance-1',
    revision: 12,
    items: [{
      ...approvalFixture('pending'),
      kind: 'files',
      operation: {
        action: 'batch_rename',
        item_count: 1,
        rename_mappings: [{ source_name: 'a.txt' }],
      },
    }],
  }), /新名称缺失/)
  assert.throws(() => decodeMcpApprovalSnapshot({
    instance_id: 'instance-1',
    revision: 12,
    items: [{
      ...approvalFixture('pending'),
      kind: 'files',
      operation: {
        action: 'batch_rename',
        item_count: 1,
        rule_count: 33,
        rename_mappings: [{ source_name: 'a.txt', target_name: 'b.txt' }],
      },
    }],
  }), /规则数超出限制/)
  assert.throws(() => decodeMcpApprovalSnapshot({
    instance_id: 'instance-1',
    revision: 12,
    items: [{
      ...approvalFixture('pending'),
      kind: 'files',
      operation: {
        action: 'batch_rename',
        item_count: 501,
        rename_mappings: Array.from({ length: 501 }, (_, index) => ({
          source_name: `source-${index}`,
          target_name: `target-${index}`,
        })),
      },
    }],
  }), /映射数量超出限制/)
  assert.throws(() => decodeMcpApprovalSnapshot({
    instance_id: 'instance-1',
    revision: 12,
    items: [{
      ...approvalFixture('pending'),
      kind: 'files',
      operation: { action: 'batch_rename', item_count: 1 },
    }],
  }), /映射缺失/)
  assert.throws(() => decodeMcpApprovalSnapshot({
    instance_id: 'instance-1',
    revision: 12,
    items: [{
      ...approvalFixture('pending'),
      kind: 'files',
      operation: {
        action: 'batch_rename',
        item_count: 2,
        rename_mappings: [{ source_name: 'a.txt', target_name: 'b.txt' }],
      },
    }],
  }), /映射数量与项目数不一致/)
})

test('删除审批保留完整顶层路径、递归范围与实际节点总量', () => {
  for (const state of ['pending', 'dispatching']) {
    const operation = deleteApprovalOperation()
    const approval = decodeMcpApprovalSnapshot({
      ...approvalSnapshotFixture(state),
      items: [{ ...approvalFixture(state), kind: 'files', operation }],
    }).items[0]!
    assert.equal(approval.kind, 'files')
    if (approval.kind !== 'files') return
    for (const key of ['recursive', 'item_count', 'top_level_count', 'file_count', 'directory_count', 'symlink_count', 'total_bytes'] as const) {
      assert.equal(approval.operation[key], operation[key])
    }
    assert.deepEqual(approval.operation.remote_paths, operation.remote_paths)
  }
  const operation = { ...deleteApprovalOperation(), recursive: false, item_count: 3, file_count: 1, directory_count: 1 }
  assert.equal(decodeMcpApprovalSnapshot({
    ...approvalSnapshotFixture('pending'),
    items: [{ ...approvalFixture('pending'), kind: 'files', operation }],
  }).items.length, 1)
  const symlinkOnly = decodeMcpApprovalSnapshot({
    ...approvalSnapshotFixture('pending'),
    items: [{ ...approvalFixture('pending'), kind: 'files', operation: {
      ...operation, remote_paths: ['/work/link'], top_level_count: 1,
      item_count: 1, file_count: 0, directory_count: 0, symlink_count: 1, total_bytes: 0,
    } }],
  }).items[0]!
  assert.equal(symlinkOnly.kind === 'files' && symlinkOnly.operation.total_bytes, 0)
})

test('待决定和派发中的删除审批拒绝缺失或不一致的范围，终态允许敏感摘要清理', () => {
  const invalidPatches = [
    { recursive: undefined }, { recursive: 'false' }, { top_level_count: undefined },
    { file_count: undefined }, { directory_count: undefined }, { symlink_count: undefined },
    { item_count: undefined }, { total_bytes: undefined }, { file_session_id: undefined },
    { item_count: 4 }, { top_level_count: 2 }, { recursive: false },
    { file_count: -1 }, { directory_count: 0.5 }, { symlink_count: Number.MAX_SAFE_INTEGER + 1 },
    { top_level_count: 0, remote_paths: [] },
    { remote_paths: ['/work/a', '/work/a', '/work/b'] },
    { remote_paths: ['relative', '/work/b', '/work/c'] },
    { remote_paths: ['/', '/work/b', '/work/c'] },
    { remote_paths: ['/work/a\0', '/work/b', '/work/c'] },
  ]
  for (const state of ['pending', 'dispatching']) {
    for (const patch of invalidPatches) {
      assert.throws(() => decodeMcpApprovalSnapshot({
        ...approvalSnapshotFixture(state),
        items: [{ ...approvalFixture(state), kind: 'files', operation: { ...deleteApprovalOperation(), ...patch } }],
      }), McpAccessProtocolError, `${state}: ${JSON.stringify(patch)}`)
    }
  }
  for (const state of ['approved', 'rejected', 'expired', 'cancelled', 'dispatch_conflict']) {
    assert.equal(decodeMcpApprovalSnapshot({
      ...approvalSnapshotFixture(state),
      items: [{ ...approvalFixture(state), kind: 'files', operation: { action: 'delete' } }],
    }).items[0]?.state, state)
  }
})

function deleteApprovalOperation() {
  return {
    action: 'delete', file_session_id: 'file-session-1', recursive: true,
    remote_paths: ['/work/目录', '/work/line\nbreak.txt', '/work/link'],
    top_level_count: 3, file_count: 5, directory_count: 2, symlink_count: 1,
    item_count: 8, total_bytes: 4096,
  }
}

function statusFixture() {
  return {
    instance_id: 'instance-1',
    enabled: true,
    revision: 4,
    state: 'enabled',
    endpoint: 'http://127.0.0.1:18131/mcp',
    protocol_version: '2025-11-25',
  }
}

function clientFixture() {
  return {
    id: 'client-1',
    name: 'Codex workspace',
    source: 'external',
    read_only: false,
    enabled: true,
    scopes: ['hosts:read', 'sessions:read'],
    host_access_mode: 'all_saved',
    token_prefix: 'tmcp_abcd',
    revision: 7,
    created_at: '2026-08-13T00:00:00Z',
    updated_at: '2026-08-13T00:01:00Z',
  }
}

function approvalSnapshotFixture(state: string) {
  return {
    instance_id: 'instance-1',
    revision: 12,
    items: [approvalFixture(state)],
  }
}

function approvalFixture(state: string) {
  return {
    id: 'approval-1',
    revision: 3,
    client_id: 'client-1',
    client_name: 'Codex workspace',
    client_request_id: 'request-1',
    command: 'uname -s',
    session_ids: ['session-1'],
    targets: [{
      id: 'session-1',
      host_id: 'host-1',
      host_name: '测试主机',
      endpoint: '127.0.0.1:22',
      status: 'connected',
      phase: 'ready',
      started_at: '2026-08-13T00:00:00Z',
      connected_at: '2026-08-13T00:00:01Z',
      host_key_confirmation_required: false,
      owned_by_client: false,
    }],
    state,
    created_at: '2026-08-13T00:01:00Z',
    updated_at: '2026-08-13T00:01:01Z',
    expires_at: '2026-08-13T00:03:00Z',
  }
}
