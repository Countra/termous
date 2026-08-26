import assert from 'node:assert/strict'
import test from 'node:test'
import type { FileSession } from '#entities/file'
import type { ForwardInstance } from '#entities/forward'
import type { RemoteDesktopSession } from '#entities/remote-desktop'
import type { Session } from '#entities/session'
import {
  countSSHProfileRuntimeUsage,
  mergeSSHProfileRuntimeUsage,
} from './sshProfileRuntimeUsage.ts'

test('SSH Profile 运行时影响只统计精确匹配的活动 Terminal、FileSession 和后台转发', () => {
  const sessions = [
    session('terminal-connecting', 'ssh-target', 'connecting'),
    session('terminal-ready', 'ssh-target', 'connected'),
    session('terminal-failed', 'ssh-target', 'failed'),
    session('terminal-other', 'ssh-other', 'connected'),
    { ...session('local', '', 'connected'), kind: 'local' as const },
  ]
  const fileSessions = [
    fileSession('file-ready', 'ssh-target', 'connected'),
    fileSession('file-waiting', 'ssh-target', 'waiting_trust'),
    fileSession('file-failed', 'ssh-target', 'failed'),
    fileSession('file-other', 'ssh-other', 'connected'),
  ]
  const forwards = [
    forward('background-ready', 'ssh-target', 'background_once', 'running'),
    forward('background-stopped', 'ssh-target', 'background_profile', 'stopped'),
    forward('session-forward', 'ssh-target', 'session', 'running'),
    forward('background-other', 'ssh-other', 'background_once', 'running'),
  ]
  const remoteDesktopSessions = [
    remoteDesktopSession('desktop-ready', 'ssh-target', 'ready'),
    remoteDesktopSession('desktop-failed', 'ssh-target', 'failed'),
    remoteDesktopSession('desktop-other', 'ssh-other', 'streaming'),
  ]

  assert.deepEqual(countSSHProfileRuntimeUsage(
    'ssh-target',
    sessions,
    fileSessions,
    forwards,
    remoteDesktopSessions,
  ), {
    terminalSessions: 2,
    fileSessions: 2,
    backgroundForwards: 1,
    remoteDesktopSessions: 2,
    total: 7,
  })
})

test('空 Profile ID 不会误计缺少身份的历史会话', () => {
  assert.deepEqual(countSSHProfileRuntimeUsage('', [session('terminal', '', 'connected')], [], []), {
    terminalSessions: 0,
    fileSessions: 0,
    backgroundForwards: 0,
    remoteDesktopSessions: 0,
    total: 0,
  })
})

test('删除提示按后端权威引用和本地实时状态的较大值展示', () => {
  assert.deepEqual(mergeSSHProfileRuntimeUsage({
    companion_files: 1,
    forward_profiles: 0,
    remote_desktop_routes: 0,
    jump_profile_consumers: 0,
    active_terminal_sessions: 3,
    active_file_sessions: 1,
    active_background_forwards: 0,
    active_remote_desktop_sessions: 2,
    active_total: 6,
    total: 1,
    blocking_total: 5,
  }, {
    terminalSessions: 1,
    fileSessions: 2,
    backgroundForwards: 1,
    remoteDesktopSessions: 1,
    total: 5,
  }), {
    terminalSessions: 3,
    fileSessions: 2,
    backgroundForwards: 1,
    remoteDesktopSessions: 2,
    total: 8,
  })
})

function remoteDesktopSession(
  id: string,
  sshProfileId: string,
  status: RemoteDesktopSession['status'],
): RemoteDesktopSession {
  return {
    id,
    profile_id: `profile-${id}`,
    profile_name: id,
    host_id: 'host-a',
    host_name: 'Host A',
    ssh_profile_id: sshProfileId,
    route: 'ssh_tunnel',
    route_config_version: 1,
    protocol: 'vnc',
    protocol_config_version: 1,
    vnc: {
      loopback_host: '127.0.0.1',
      port: 5900,
      shared: true,
      default_view_only: false,
      default_display_mode: 'fit',
    },
    status,
    phase: status === 'failed' ? 'failed' : 'ready',
    connection_generation: 1,
    viewer_attached: false,
    created_at: '2026-08-26T00:00:00Z',
    updated_at: '2026-08-26T00:00:00Z',
  }
}

function session(id: string, sshProfileId: string, status: Session['status']): Session {
  return {
    id,
    kind: 'ssh',
    origin: 'app',
    host_id: 'host-a',
    ssh_profile_id: sshProfileId || undefined,
    status,
    started_at: '2026-08-26T00:00:00Z',
    pty_cols: 120,
    pty_rows: 32,
  }
}

function forward(
  id: string,
  sshProfileId: string,
  scope: ForwardInstance['scope'],
  status: ForwardInstance['status'],
): ForwardInstance {
  return {
    id,
    ssh_profile_id: sshProfileId,
    name: id,
    mode: 'local',
    scope,
    status,
    phase: status === 'running' ? 'ready' : 'stopped',
    progress: status === 'running' ? 100 : 0,
    bind_host: '127.0.0.1',
    bind_port: 8022,
    target_host: '127.0.0.1',
    target_port: 22,
    active_connections: 0,
    total_connections: 0,
    bytes_in: 0,
    bytes_out: 0,
    started_at: '2026-08-26T00:00:00Z',
  }
}

function fileSession(
  id: string,
  sshProfileId: string,
  status: FileSession['status'],
): FileSession {
  return {
    id,
    host_id: 'host-a',
    file_access_profile_id: `file-${sshProfileId}`,
    ssh_profile_id: sshProfileId,
    engine: 'sftp',
    namespace: 'posix',
    capabilities: ['browse'],
    origin: 'app',
    status,
    current_path: '/',
    started_at: '2026-08-26T00:00:00Z',
  }
}
