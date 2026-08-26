import assert from 'node:assert/strict'
import test from 'node:test'
import type { Host, HostGroup, HostReachability } from '#entities/host'
import {
  buildGroupFilterOptions,
  buildTagOptions,
  filterHosts,
  formatDateTime,
  formatReachabilityLatency,
  groupHosts,
  latencyLevel,
  latencySignalLabel,
  reachabilityTooltip,
  type LauncherPlatformFilter,
} from './hostLauncherListModel.ts'

test('搜索词使用 AND 语义并与平台、分组、认证和标签筛选叠加', () => {
  const alpha = host({
    id: 'alpha',
    name: 'Alpha Database',
    group_id: 'ops',
    username: 'root',
    auth_method: 'private_key',
    tags: ['Production', 'Database'],
    note: 'primary node',
  })
  const wrongAuth = host({
    id: 'wrong-auth',
    name: 'Alpha Database',
    group_id: 'ops',
    username: 'root',
    auth_method: 'password',
    tags: ['Production', 'Database'],
  })
  const wrongQuery = host({
    id: 'wrong-query',
    name: 'Alpha Cache',
    group_id: 'ops',
    username: 'deploy',
    auth_method: 'private_key',
    tags: ['Production', 'Database'],
  })
  const result = filterHosts(
    [wrongAuth, wrongQuery, alpha],
    new Map([['ops', 'Operations']]),
    {},
    'alpha root primary',
    'all',
    'linux',
    'ops',
    'private_key',
    ['production', 'DATABASE'],
  )

  assert.deepEqual(result.map((item) => item.id), ['alpha'])
  assert.deepEqual(
    filterHosts([alpha], new Map(), {}, '', 'all', 'windows' as LauncherPlatformFilter, 'all', 'all', []),
    [],
  )
})

test('在线筛选同时保留 online 和 checking 状态', () => {
  const source = [host({ id: 'online' }), host({ id: 'checking' }), host({ id: 'offline' })]
  const result = filterHosts(
    source,
    new Map(),
    {
      online: reachability('online', 'online'),
      checking: reachability('checking', 'checking'),
      offline: reachability('offline', 'offline'),
    },
    '',
    'online',
    'all',
    'all',
    'all',
    [],
  )

  assert.deepEqual(result.map((item) => item.id).sort(), ['checking', 'online'])
})

test('排序兼容无效时间且不改写输入顺序和对象', () => {
  const source = [
    host({ id: 'invalid', name: 'Zulu', last_connected_at: 'not-a-date' }),
    host({ id: 'older', name: 'Beta', last_connected_at: '2026-08-24T00:00:00Z' }),
    host({ id: 'favorite', name: 'Omega', favorite: true, last_connected_at: '2026-08-20T00:00:00Z' }),
    host({ id: 'newer', name: 'Alpha', last_connected_at: '2026-08-25T00:00:00Z' }),
  ]
  const snapshot = structuredClone(source)

  const all = filterHosts(source, new Map(), {}, '', 'all', 'all', 'all', 'all', [])
  const recent = filterHosts(source, new Map(), {}, '', 'recent', 'all', 'all', 'all', [])

  assert.deepEqual(all.map((item) => item.id), ['favorite', 'newer', 'older', 'invalid'])
  assert.deepEqual(recent.map((item) => item.id), ['newer', 'older', 'favorite'])
  assert.deepEqual(source, snapshot)
  assert.deepEqual(source.map((item) => item.id), ['invalid', 'older', 'favorite', 'newer'])
})

test('分组遵循配置顺序并将未分组主机放在末尾且不改写输入', () => {
  const groups: HostGroup[] = [group('production', 'Production', 0), group('staging', 'Staging', 1)]
  const source = [
    host({ id: 'ungrouped', group_id: '' }),
    host({ id: 'staging', group_id: 'staging' }),
    host({ id: 'production', group_id: 'production' }),
  ]
  const snapshot = structuredClone(source)

  const result = groupHosts(source, groups, 'Ungrouped')

  assert.deepEqual(result.map((item) => item.id), ['production', 'staging', '__ungrouped'])
  assert.deepEqual(result.map((item) => item.hosts.map((hostItem) => hostItem.id)), [
    ['production'],
    ['staging'],
    ['ungrouped'],
  ])
  assert.deepEqual(buildGroupFilterOptions(source, groups, 'Ungrouped', 'All'), [
    { value: 'all', label: 'All' },
    { value: 'production', label: 'Production' },
    { value: 'staging', label: 'Staging' },
    { value: '__ungrouped', label: 'Ungrouped' },
  ])
  assert.deepEqual(source, snapshot)
  assert.deepEqual(groups, [group('production', 'Production', 0), group('staging', 'Staging', 1)])
})

test('标签按主机去重计数并保留首个展示文本', () => {
  const source = [
    host({ id: 'first', tags: [' Production ', 'production', '', 'Database'] }),
    host({ id: 'second', tags: ['PRODUCTION', 'Cache'] }),
  ]
  const snapshot = structuredClone(source)

  assert.deepEqual(buildTagOptions(source), [
    { key: 'cache', label: 'Cache', count: 1 },
    { key: 'database', label: 'Database', count: 1 },
    { key: 'production', label: 'Production', count: 2 },
  ])
  assert.deepEqual(source, snapshot)
})

test('延迟阈值、文案投影和代理提示保持稳定边界', () => {
  const t = (key: string, options?: Record<string, string | number>) => (
    options ? `${key}:${JSON.stringify(options)}` : key
  )

  assert.equal(latencyLevel(reachability('low-edge', 'online', 80)), 'low')
  assert.equal(latencyLevel(reachability('medium-start', 'online', 81)), 'medium')
  assert.equal(latencyLevel(reachability('medium-edge', 'online', 180)), 'medium')
  assert.equal(latencyLevel(reachability('high-start', 'online', 181)), 'high')
  assert.equal(latencyLevel(reachability('checking', 'checking', 1)), 'unknown')
  assert.match(formatReachabilityLatency(reachability('online', 'online', 42), t), /42/)
  assert.equal(
    formatReachabilityLatency(reachability('checking', 'checking'), t),
    'workbench.hostLauncher.reachability.checking',
  )
  assert.match(latencySignalLabel(reachability('high', 'online', 181), t), /high/)
  assert.match(reachabilityTooltip(reachability('proxy', 'online', 12), t, true), /proxies\.reachabilityDirectHint/)
})

test('日期格式化对缺失和无效值使用 fallback', () => {
  assert.equal(formatDateTime(undefined, 'none'), 'none')
  assert.equal(formatDateTime('not-a-date', 'none'), 'none')
  assert.notEqual(formatDateTime('2026-08-26T12:00:00Z', 'none'), 'none')
})

function host(patch: Partial<Host> = {}): Host {
  return {
    id: 'host',
    name: 'Host',
    platform: 'linux',
    group_id: '',
    address: '192.0.2.10',
    port: 22,
    username: 'root',
    auth_method: 'password',
    credential_id: 'credential',
    tags: [],
    favorite: false,
    fingerprint_policy: 'confirm_on_change',
    ...patch,
  }
}

function group(id: string, name: string, sortOrder: number): HostGroup {
  return { id, name, sort_order: sortOrder }
}

function reachability(
  hostId: string,
  status: HostReachability['status'],
  latencyMs?: number,
): HostReachability {
  return {
    host_id: hostId,
    ssh_profile_id: `ssh-${hostId}`,
    address: '192.0.2.10',
    status,
    latency_ms: latencyMs,
    packet_loss: status === 'online' ? 0 : 1,
  }
}
