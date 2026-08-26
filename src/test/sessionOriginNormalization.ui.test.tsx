import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRuntimeGatewaysFromConfig } from '#app/data-runtime'

const apiBaseUrl = 'http://127.0.0.1:8122'

const legacySession = {
  id: 'session-a',
  kind: 'ssh',
  host_id: 'host-a',
  status: 'connected',
  started_at: '2026-08-17T00:00:00Z',
  pty_cols: 120,
  pty_rows: 32,
}

const legacyFileSession = {
  id: 'file-session-a',
  host_id: 'host-a',
  file_access_profile_id: 'file-profile-a',
  ssh_profile_id: 'ssh-profile-a',
  engine: 'sftp',
  namespace: 'posix',
  capabilities: ['browse'],
  status: 'connected',
  phase: 'ready',
  current_path: '/',
  started_at: '2026-08-17T00:00:00Z',
  connection_generation: 1,
  state_seq: 1,
}

function gateways() {
  return createRuntimeGatewaysFromConfig({
    apiBaseUrl,
    apiToken: 'test-token',
    version: '1.0.0-test',
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('会话来源 REST 兼容合同', () => {
  it('SSH 与 SFTP 的 list/create/get/reconnect 为旧 Core 回填 app 来源', async () => {
    const responseBodies: unknown[] = [
      [legacySession],
      legacySession,
      legacySession,
      [legacyFileSession],
      legacyFileSession,
      legacyFileSession,
      legacyFileSession,
    ]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify(responseBodies.shift()),
      { status: 200 },
    )))
    const runtime = gateways()

    await expect(runtime.sessions.sessions()).resolves.toEqual([
      expect.objectContaining({ origin: 'app' }),
    ])
    await expect(runtime.sessions.createSession('host-a', 120, 32)).resolves
      .toEqual(expect.objectContaining({ origin: 'app' }))
    await expect(runtime.sessions.refreshSessionInventory('session-a')).resolves
      .toEqual(expect.objectContaining({ origin: 'app' }))
    await expect(runtime.fileSessions.fileSessions()).resolves.toEqual([
      expect.objectContaining({ origin: 'app' }),
    ])
    await expect(runtime.fileSessions.createFileSession({ hostId: 'host-a' })).resolves
      .toEqual(expect.objectContaining({ origin: 'app' }))
    await expect(runtime.fileSessions.getFileSession('file-session-a')).resolves
      .toEqual(expect.objectContaining({ origin: 'app' }))
    await expect(runtime.fileSessions.reconnectFileSession('file-session-a')).resolves
      .toEqual(expect.objectContaining({ origin: 'app' }))
  })

  it('精确 File Profile 创建请求不携带 host_id', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify(legacyFileSession),
      { status: 200 },
    ))
    vi.stubGlobal('fetch', fetchMock)
    const runtime = gateways()

    await runtime.fileSessions.createFileSession({
      fileAccessProfileId: 'file-profile-a',
      sourceSessionId: 'session-a',
      initialPath: '/srv',
    })

    const [, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      file_access_profile_id: 'file-profile-a',
      source_session_id: 'session-a',
      initial_path: '/srv',
    })
  })

  it('SSH 会话兼容 Host 默认项并支持精确 SSH Profile 请求', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify(legacySession),
      { status: 201 },
    ))
    vi.stubGlobal('fetch', fetchMock)
    const runtime = gateways()

    await runtime.sessions.createSession('host-a', 120, 32)
    await runtime.sessions.createSSHSession({ sshProfileId: 'ssh-profile-a' }, 100, 40)

    const [, hostInit] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(JSON.parse(String(hostInit.body))).toEqual({
      host_id: 'host-a',
      cols: 120,
      rows: 32,
    })
    const [, profileInit] = fetchMock.mock.calls[1] as unknown as [URL, RequestInit]
    expect(JSON.parse(String(profileInit.body))).toEqual({
      ssh_profile_id: 'ssh-profile-a',
      cols: 100,
      rows: 40,
    })
  })

  it('SSH 会话创建在运行时拒绝缺失、冲突或未规范化的目标', () => {
    const runtime = gateways()
    expect(() => runtime.sessions.createSSHSession({} as never, 120, 32))
      .toThrow('SSH 连接必须且只能指定一种目标')
    expect(() => runtime.sessions.createSSHSession({
      hostId: 'host-a',
      sshProfileId: 'ssh-profile-a',
    } as never, 120, 32)).toThrow('SSH 连接必须且只能指定一种目标')
    expect(() => runtime.sessions.createSSHSession({ hostId: ' host-a ' }, 120, 32))
      .toThrow('主机 ID 无效')
    expect(() => runtime.sessions.createSSHSession({ sshProfileId: '' }, 120, 32))
      .toThrow('SSH Profile ID 无效')
  })

  it('兼容 Host 默认项创建请求只携带 host_id', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify(legacyFileSession),
      { status: 200 },
    ))
    vi.stubGlobal('fetch', fetchMock)
    const runtime = gateways()

    await runtime.fileSessions.createFileSession({ hostId: 'host-a' })

    const [, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ host_id: 'host-a' })
  })

  it('文件会话创建在运行时拒绝缺失或冲突的目标选择器', () => {
    const runtime = gateways()
    expect(() => runtime.fileSessions.createFileSession({} as never))
      .toThrow('文件连接必须且只能指定一种目标')
    expect(() => runtime.fileSessions.createFileSession({
      hostId: 'host-a',
      fileAccessProfileId: 'file-profile-a',
    } as never)).toThrow('文件连接必须且只能指定一种目标')
  })

  it('REST 拒绝未知来源并公开全局文件会话事件地址', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      { ...legacyFileSession, origin: 'external' },
    ]), { status: 200 })))
    const runtime = gateways()

    await expect(runtime.fileSessions.fileSessions()).rejects.toThrow(/文件会话来源/)
    expect(runtime.fileSessions.fileSessionSnapshotsUrl()).toBe(
      'ws://127.0.0.1:8122/api/v1/file-sessions/events?token=test-token',
    )
  })
})
