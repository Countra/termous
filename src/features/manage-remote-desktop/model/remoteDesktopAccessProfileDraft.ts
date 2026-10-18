import { isValidRemoteDesktopIPAddress, type RemoteDesktopAccessProfile, type RemoteDesktopAccessProfileInput, type RemoteDesktopProtocol, type RdpProfileSettings } from '#entities/remote-desktop'
import { createVNCAccessProfileDraft, normalizeVNCAccessProfileDraft, validateVNCAccessProfileDraft, vncAccessProfileToDraft, type VNCAccessProfileDraft, type VNCAccessProfileDraftErrors } from './vncAccessProfileDraft.ts'

export type RDPAccessProfileDraft = Omit<VNCAccessProfileDraft, 'protocol' | 'vnc' | 'route_memory'> & {
  protocol: 'rdp'
  rdp: Omit<RdpProfileSettings, 'port' | 'width' | 'height'> & {
    port: number | null
    width: number | null
    height: number | null
  }
  route_memory?: { direct_target_host?: string; tunnel_target_host?: string; ssh_profile_id: string }
}
export type RemoteDesktopAccessProfileDraft = (VNCAccessProfileDraft | RDPAccessProfileDraft) & {
  // 仅保留当前编辑中的协议草稿，规范化时不写入持久配置。
  protocol_memory?: { vnc?: VNCAccessProfileDraft; rdp?: RDPAccessProfileDraft }
}
export type RemoteDesktopAccessProfileDraftErrors = VNCAccessProfileDraftErrors & {
  username?: 'required' | 'invalid'
  domain?: 'invalid'
  width?: 'range'
  height?: 'range'
  dimensions?: 'range'
  server_name?: 'invalid'
}

export function createRemoteDesktopAccessProfileDraft(sshProfileId = '', protocol: RemoteDesktopProtocol = 'vnc'): RemoteDesktopAccessProfileDraft {
  const base = createVNCAccessProfileDraft(sshProfileId)
  if (protocol === 'vnc') return base
  return { name: '', description: '', route: base.route, ssh_profile_id: base.ssh_profile_id, protocol: 'rdp',
    rdp: { target_host: base.vnc.target_host, port: 3389, server_name: '', username: '', domain: '', width: 1920, height: 1080, audio: true, default_view_only: false, default_display_mode: 'fit' } }
}

export function changeRemoteDesktopAccessProfileProtocol(
  draft: RemoteDesktopAccessProfileDraft,
  protocol: RemoteDesktopProtocol,
): RemoteDesktopAccessProfileDraft {
  if ((draft.protocol ?? 'vnc') === protocol) return draft
  const { protocol_memory: memory = {}, ...current } = draft
  const next = memory[protocol] ?? createRemoteDesktopAccessProfileDraft(draft.ssh_profile_id, protocol)
  const protocolMemory = current.protocol === 'rdp' ? { ...memory, rdp: current } : { ...memory, vnc: current }
  return { ...next, name: draft.name, description: draft.description, protocol_memory: protocolMemory }
}

export function changeRDPAccessProfileRoute(
  draft: RDPAccessProfileDraft,
  route: RDPAccessProfileDraft['route'],
  defaultSSHProfileId = '',
): RDPAccessProfileDraft {
  if (route === draft.route) return draft
  const memory = {
    direct_target_host: draft.route === 'direct' ? draft.rdp.target_host : draft.route_memory?.direct_target_host,
    tunnel_target_host: draft.route === 'ssh_tunnel' ? draft.rdp.target_host : draft.route_memory?.tunnel_target_host,
    ssh_profile_id: draft.route === 'ssh_tunnel' ? draft.ssh_profile_id : draft.route_memory?.ssh_profile_id ?? '',
  }
  const target = route === 'direct'
    ? memory.direct_target_host ?? (isValidRemoteDesktopIPAddress(draft.rdp.target_host) ? draft.rdp.target_host : '')
    : memory.tunnel_target_host ?? (draft.rdp.target_host || '127.0.0.1')
  return { ...draft, route, route_memory: memory,
    ssh_profile_id: route === 'ssh_tunnel' ? memory.ssh_profile_id || defaultSSHProfileId : '',
    rdp: { ...draft.rdp, target_host: target } }
}
export function remoteDesktopAccessProfileToDraft(profile: RemoteDesktopAccessProfile): RemoteDesktopAccessProfileDraft {
  if (profile.protocol === 'vnc') return vncAccessProfileToDraft(profile)
  return { name: profile.name, description: profile.description, route: profile.route, ssh_profile_id: profile.ssh_profile_id ?? '', protocol: 'rdp', rdp: { ...profile.rdp } }
}
export function normalizeRemoteDesktopAccessProfileDraft(hostId: string, draft: RemoteDesktopAccessProfileDraft): RemoteDesktopAccessProfileInput {
  if (draft.protocol !== 'rdp') return normalizeVNCAccessProfileDraft(hostId, draft)
  const common = { host_id: hostId, name: draft.name.trim(), description: draft.description.trim(), protocol: 'rdp' as const, protocol_config_version: 1 as const,
    rdp: { ...draft.rdp, port: draft.rdp.port ?? 0, width: draft.rdp.width ?? 0, height: draft.rdp.height ?? 0,
      target_host: draft.rdp.target_host.trim(), server_name: draft.rdp.server_name.trim() || draft.rdp.target_host.trim(), username: draft.rdp.username.trim(), domain: draft.rdp.domain.trim() } }
  return draft.route === 'ssh_tunnel' ? { ...common, route: 'ssh_tunnel', route_config_version: 1, ssh_profile_id: draft.ssh_profile_id.trim() } : { ...common, route: 'direct', route_config_version: 1 }
}
export function validateRemoteDesktopAccessProfileDraft(draft: RemoteDesktopAccessProfileDraft, sshIds: ReadonlySet<string>): RemoteDesktopAccessProfileDraftErrors {
  if (draft.protocol !== 'rdp') return validateVNCAccessProfileDraft(draft, sshIds)
  const errors: RemoteDesktopAccessProfileDraftErrors = {}
  if (!draft.name.trim()) errors.name = 'required'
  else if (Array.from(draft.name.trim()).length > 80) errors.name = 'too_long'
  if (draft.route === 'ssh_tunnel') { if (!draft.ssh_profile_id) errors.ssh_profile_id = 'required'; else if (!sshIds.has(draft.ssh_profile_id)) errors.ssh_profile_id = 'missing' }
  const c = draft.rdp
  if (!c.target_host.trim()) errors.target_host = 'required'
  else if (draft.route === 'direct' ? !isValidRemoteDesktopIPAddress(c.target_host.trim()) : !validRDPHost(c.target_host.trim())) errors.target_host = 'invalid'
  if (c.server_name.trim() && !validRDPHost(c.server_name.trim())) errors.server_name = 'invalid'
  if (!Number.isInteger(c.port) || (c.port ?? 0) < 1 || (c.port ?? 0) > 65535) errors.port = 'range'
  if (!c.username.trim()) errors.username = 'required'
  else if (!validAccountText(c.username.trim())) errors.username = 'invalid'
  if (!validAccountText(c.domain.trim())) errors.domain = 'invalid'
  for (const dimension of ['width', 'height'] as const) {
    const n = c[dimension]
    if (n === null || !Number.isInteger(n) || n < 200 || n > 8192 || n % 2 !== 0) errors[dimension] = 'range'
  }
  if (!errors.width && !errors.height && (c.width ?? 0) * (c.height ?? 0) > 16 * 1024 * 1024) errors.dimensions = 'range'
  return errors
}
export function remoteDesktopAccessProfileDraftsEqual(a: RemoteDesktopAccessProfileDraft, b: RemoteDesktopAccessProfileDraft) {
  return JSON.stringify(normalizeRemoteDesktopAccessProfileDraft('', a)) === JSON.stringify(normalizeRemoteDesktopAccessProfileDraft('', b))
}

function validRDPHost(value: string) {
  if (value.length > 253) return false
  if (isValidRemoteDesktopIPAddress(value)) return true
  // 已识别但不可连接的 IP 不能回退成域名；纯数字主机名仍与 Core 保持兼容。
  const parts = value.split('.')
  const isIPv4 = parts.length === 4 && parts.every((part) => /^(?:0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255)
  if (isIPv4 || value.includes(':')) return false
  return value.split('.').every((label) => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label))
}

function validAccountText(value: string) {
  return new TextEncoder().encode(value).length <= 256
    && !['\0', '\r', '\n'].some((character) => value.includes(character))
}
