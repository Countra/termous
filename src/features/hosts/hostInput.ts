import type { Host, HostInput } from '../../types/domain'

export function hostToInput(host: Host): HostInput {
  return {
    name: host.name,
    platform: host.platform ?? 'linux',
    icon_id: host.icon_id ?? '',
    group_id: host.group_id,
    address: host.address,
    port: host.port,
    username: host.username,
    auth_method: host.auth_method,
    credential_id: host.credential_id,
    jump_host_id: host.jump_host_id ?? '',
    proxy_id: host.proxy_id ?? '',
    tags: [...(host.tags ?? [])],
    favorite: Boolean(host.favorite),
    fingerprint_policy: host.fingerprint_policy,
    note: host.note ?? '',
  }
}
