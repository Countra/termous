import {
  normalizeHostAssetInput,
  type HostProvisionInput,
  type HostProvisionDesktopInput,
} from '#entities/host-asset'
import { normalizeSSHAccessProfileDraft, type SSHAccessProfile } from '#entities/ssh-access-profile'
import { normalizeVNCAccessProfileDraft } from '#features/manage-remote-desktop'
import type { HostCreationDraft } from './hostCreationTypes.ts'

export const hostCreationTemporaryHostId = 'draft:host'

export function formatHostCreationEndpoint(host: string, port: number | null): string {
  const address = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  return `${address}:${port ?? ''}`
}

// 仅供创建表单的选项和列表展示；临时投影不得发布到全局目录或用于建立连接。
export function projectHostCreationSSH(state: HostCreationDraft): SSHAccessProfile[] {
  return state.ssh.map((item, index) => ({
    ...normalizeSSHAccessProfileDraft(item.draft),
    id: item.id,
    host_id: hostCreationTemporaryHostId,
    is_default: item.isDefault,
    sort_order: index,
    created_at: '',
    updated_at: '',
  }))
}

export function normalizeHostProvisionInput(state: HostCreationDraft): HostProvisionInput {
  const localSSHIds = new Set(state.ssh.map((item) => item.id))
  return {
    client_request_id: state.clientRequestId,
    host: normalizeHostAssetInput(state.host),
    ssh: state.ssh.map((item) => {
      const input = normalizeSSHAccessProfileDraft(item.draft)
      const localJump = localSSHIds.has(input.jump_ssh_profile_id)
      if (input.jump_ssh_profile_id.startsWith('draft:') && !localJump) {
        throw new Error('本地 SSH 跳板草稿不存在')
      }
      return {
        ...input,
        draft_id: item.id,
        jump_ssh_profile_id: localJump ? '' : input.jump_ssh_profile_id,
        ...(localJump ? { jump_draft_id: input.jump_ssh_profile_id } : {}),
        is_default: item.isDefault,
        file_name: item.fileName.trim(),
        file_is_default: item.fileIsDefault,
      }
    }),
    remote_desktops: state.remoteDesktops.map((item): HostProvisionDesktopInput => {
      const input = normalizeVNCAccessProfileDraft(hostCreationTemporaryHostId, item.draft)
      if (input.route === 'ssh_tunnel' && !localSSHIds.has(input.ssh_profile_id)) {
        throw new Error('远程桌面引用的本地 SSH 草稿不存在')
      }
      // 显式投影剔除临时 host_id、路由切换记忆和未启用的密码，避免草稿结构泄漏进持久协议。
      return {
        draft_id: item.id,
        name: input.name,
        description: input.description,
        protocol: input.protocol,
        protocol_config_version: input.protocol_config_version,
        route: input.route,
        route_config_version: input.route_config_version,
        vnc: input.vnc,
        ...(input.route === 'ssh_tunnel' ? { ssh_draft_id: input.ssh_profile_id } : {}),
        ...(item.targetAuthDraft.mutation === 'replace'
          ? { target_auth_password: item.targetAuthDraft.password }
          : {}),
        is_default: item.isDefault,
      }
    }),
  }
}
