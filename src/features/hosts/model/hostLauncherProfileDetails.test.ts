import assert from 'node:assert/strict'
import test from 'node:test'
import type { HostLauncherData } from './types.ts'
import type { HostLauncherProfileMenuItem } from './hostLauncherProfiles.ts'
import {
  effectiveSSHProfileId,
  resolveHostLauncherProfileDetails,
} from './hostLauncherProfileDetails.ts'

test('SSH Profile 投影当前凭据、跳板与代理且不暴露代理 URL', () => {
    const data = launcherData()
    const item = sshItem('ssh-main')
    const details = resolveHostLauncherProfileDetails(data, item)

    assert.equal(details?.endpoint, 'deploy@prod.example:2202')
    assert.equal(details?.sshProfileId, 'ssh-main')
    assert.deepEqual(details?.sshCredential, {
      name: 'Production key',
      type: 'private_key',
    })
    assert.deepEqual(details?.primaryCredential, details?.sshCredential)
    assert.deepEqual(details?.proxy, { name: 'Office SOCKS', type: 'socks5' })
    assert.deepEqual(details?.jump, {
      hostName: 'Gateway',
      profileName: 'Gateway SSH',
      endpoint: 'jump@gateway.example:22',
      credential: { name: 'Gateway password', type: 'password' },
    })
    assert.doesNotMatch(JSON.stringify(details), /proxy-user|proxy-pass/)
})

test('SFTP 与 SSH 隧道路由使用关联 SSH Profile，直连 VNC 不回退默认 SSH', () => {
    const data = launcherData()
    const fileItem = fileProfile('file-main', {
      profileId: 'ssh-main',
      name: 'Production SSH',
      endpoint: 'deploy@prod.example:2202',
    })
    const fileDetails = resolveHostLauncherProfileDetails(data, fileItem)
    assert.equal(effectiveSSHProfileId(fileItem), 'ssh-main')
    assert.equal(fileDetails?.sshProfileId, 'ssh-main')
    assert.equal(fileDetails?.lastDirectory, '/srv/releases')

    const directItem = desktopProfile('desktop-direct', null)
    const directDetails = resolveHostLauncherProfileDetails(data, directItem)
    assert.equal(effectiveSSHProfileId(directItem), null)
    assert.equal(directDetails?.endpoint, 'vnc.internal:5901')
    assert.equal(directDetails?.sshProfileId, null)
    assert.equal(directDetails?.sshCredential, null)
    assert.deepEqual(directDetails?.primaryCredential, {
      name: 'VNC password',
      type: 'password',
    })
    assert.equal(directDetails?.proxy, null)
    assert.equal(directDetails?.jump, null)
    assert.deepEqual(directDetails?.remoteDesktop, {
      description: 'Production console',
      targetCredential: { name: 'VNC password', type: 'password' },
      shared: true,
      viewOnly: false,
      displayMode: 'fit',
    })
})

test('失效路由保持为空，不借用主机默认 SSH Profile', () => {
    const data = launcherData()
    const item: HostLauncherProfileMenuItem = {
      ...fileProfile('file-main', null),
      endpoint: '',
      availability: 'route_missing',
    }

    const details = resolveHostLauncherProfileDetails(data, item)
    assert.equal(effectiveSSHProfileId(item), null)
    assert.equal(details?.endpoint, '')
    assert.equal(details?.sshProfileId, null)
    assert.equal(details?.primaryCredential, null)
    assert.equal(details?.proxy, null)
    assert.equal(details?.jump, null)
})

function launcherData(): HostLauncherData {
  return {
    hostAssets: [
      hostAsset('host-a', 'Production'),
      hostAsset('host-jump', 'Gateway'),
    ],
    groups: [],
    proxies: [{
      id: 'proxy-a',
      name: 'Office SOCKS',
      type: 'socks5',
      url: 'socks5://proxy-user:proxy-pass@127.0.0.1:1080',
      bound_host_count: 1,
    }],
    credentials: [
      credential('credential-main', 'Production key', 'private_key'),
      credential('credential-jump', 'Gateway password', 'password'),
      credential('credential-vnc', 'VNC password', 'password'),
    ],
    hostReachability: {},
    sshAccessProfiles: [
      {
        id: 'ssh-main',
        host_id: 'host-a',
        name: 'Production SSH',
        address: 'prod.example',
        port: 2202,
        username: 'deploy',
        auth_method: 'private_key',
        credential_id: 'credential-main',
        proxy_id: 'proxy-a',
        jump_ssh_profile_id: 'ssh-jump',
        fingerprint: 'SHA256:production',
        fingerprint_policy: 'confirm_on_change',
        is_default: true,
        sort_order: 0,
        created_at: '2026-08-01T00:00:00Z',
        updated_at: '2026-08-02T00:00:00Z',
        last_connected_at: '2026-08-03T00:00:00Z',
      },
      {
        id: 'ssh-jump',
        host_id: 'host-jump',
        name: 'Gateway SSH',
        address: 'gateway.example',
        port: 22,
        username: 'jump',
        auth_method: 'password',
        credential_id: 'credential-jump',
        fingerprint_policy: 'confirm_on_change',
        is_default: true,
        sort_order: 0,
        created_at: '2026-08-01T00:00:00Z',
        updated_at: '2026-08-02T00:00:00Z',
      },
    ],
    fileAccessProfiles: [{
      id: 'file-main',
      host_id: 'host-a',
      name: 'Production files',
      engine: 'sftp',
      engine_config_version: 1,
      sftp: { ssh_profile_id: 'ssh-main' },
      is_default: true,
      sort_order: 0,
      last_directory: '/srv/releases',
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-02T00:00:00Z',
    }],
    remoteDesktopProfiles: [{
      id: 'desktop-direct',
      host_id: 'host-a',
      name: 'Production desktop',
      description: 'Production console',
      route: 'direct',
      route_config_version: 1,
      protocol: 'vnc',
      protocol_config_version: 1,
      target_auth: {
        credential_id: 'credential-vnc',
        updated_at: '2026-08-02T00:00:00Z',
      },
      vnc: {
        target_host: 'vnc.internal',
        port: 5901,
        shared: true,
        default_view_only: false,
        default_display_mode: 'fit',
      },
      is_default: true,
      sort_order: 0,
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-02T00:00:00Z',
    }],
  }
}

function hostAsset(id: string, name: string) {
  return {
    id,
    name,
    platform: 'linux' as const,
    group_id: '',
    tags: [],
    favorite: false,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-02T00:00:00Z',
  }
}

function credential(
  id: string,
  name: string,
  type: 'password' | 'private_key',
) {
  return {
    id,
    name,
    type,
    vault_id: `${id}-vault`,
    metadata: {},
    bound_host_count: 1,
  }
}

function sshItem(profileId: string): HostLauncherProfileMenuItem {
  return {
    profileId,
    hostId: 'host-a',
    intent: 'terminal',
    actionId: 'connect',
    technology: 'ssh',
    name: 'Production SSH',
    endpoint: 'deploy@prod.example:2202',
    route: null,
    isDefault: true,
    sortOrder: 0,
    availability: 'ready',
  }
}

function fileProfile(
  profileId: string,
  route: HostLauncherProfileMenuItem['route'],
): Extract<HostLauncherProfileMenuItem, { intent: 'files' }> {
  return {
    profileId,
    hostId: 'host-a',
    intent: 'files',
    actionId: 'openFiles',
    technology: 'sftp',
    name: 'Production files',
    endpoint: route?.endpoint ?? '',
    route,
    isDefault: true,
    sortOrder: 0,
    availability: route ? 'ready' : 'route_missing',
  }
}

function desktopProfile(
  profileId: string,
  route: HostLauncherProfileMenuItem['route'],
): Extract<HostLauncherProfileMenuItem, { intent: 'remote_desktop' }> {
  return {
    profileId,
    hostId: 'host-a',
    intent: 'remote_desktop',
    actionId: 'openRemoteDesktop',
    technology: 'vnc',
    name: 'Production desktop',
    endpoint: 'vnc.internal:5901',
    route,
    isDefault: true,
    sortOrder: 0,
    availability: 'ready',
  }
}
