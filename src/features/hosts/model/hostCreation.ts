import { hostAssetInputsEqual, type HostAssetInput } from '#entities/host-asset'
import { createSSHAccessProfileDraft } from '#entities/ssh-access-profile'
import { createVNCAccessProfileDraft, createVNCTargetAuthDraft } from '#features/manage-remote-desktop'
import type {
  HostCreationConnectionKind,
  HostCreationDesktop,
  HostCreationDraft,
  HostCreationSSH,
} from './hostCreationTypes.ts'

export type * from './hostCreationTypes.ts'
export { validateHostCreationDraft } from './hostCreationValidation.ts'
export {
  hostCreationTemporaryHostId,
  normalizeHostProvisionInput,
  projectHostCreationSSH,
} from './hostCreationProjection.ts'

export function createHostAssetDraft(): HostAssetInput {
  return { name: '', platform: 'linux', icon_id: '', group_id: '', tags: [], favorite: false, note: '' }
}

export function createHostCreationDraft(): HostCreationDraft {
  return { clientRequestId: crypto.randomUUID(), host: createHostAssetDraft(), ssh: [], remoteDesktops: [] }
}

export function isHostCreationDirty(state: HostCreationDraft) {
  return state.ssh.length > 0 || state.remoteDesktops.length > 0
    || !hostAssetInputsEqual(state.host, createHostAssetDraft())
}

export function addHostCreationSSH(state: HostCreationDraft) {
  const id = `draft:${crypto.randomUUID()}`
  const item: HostCreationSSH = {
    id,
    draft: createSSHAccessProfileDraft(),
    fileName: 'SFTP',
    isDefault: state.ssh.length === 0,
    fileIsDefault: state.ssh.length === 0,
  }
  return { draft: { ...state, ssh: [...state.ssh, item] }, id }
}

export function addHostCreationRemoteDesktop(state: HostCreationDraft) {
  const id = `draft:${crypto.randomUUID()}`
  const item: HostCreationDesktop = {
    id,
    draft: createVNCAccessProfileDraft(state.ssh.find((profile) => profile.isDefault)?.id),
    targetAuthDraft: createVNCTargetAuthDraft(),
    isDefault: state.remoteDesktops.length === 0,
  }
  return { draft: { ...state, remoteDesktops: [...state.remoteDesktops, item] }, id }
}

export function updateHostCreationSSH(
  state: HostCreationDraft,
  id: string,
  patch: Partial<Pick<HostCreationSSH, 'draft' | 'fileName'>>,
): HostCreationDraft {
  return { ...state, ssh: state.ssh.map((item) => item.id === id ? { ...item, ...patch } : item) }
}

export function updateHostCreationRemoteDesktop(
  state: HostCreationDraft,
  id: string,
  patch: Partial<Pick<HostCreationDesktop, 'draft' | 'targetAuthDraft'>>,
): HostCreationDraft {
  return {
    ...state,
    remoteDesktops: state.remoteDesktops.map((item) => item.id === id ? { ...item, ...patch } : item),
  }
}

export function removeHostCreationConnection(
  state: HostCreationDraft,
  kind: 'ssh' | 'remote_desktop',
  id: string,
): { draft: HostCreationDraft; blockedBy?: { kind: 'ssh' | 'remote_desktop'; id: string }[] } {
  if (kind === 'remote_desktop') {
    const remaining = state.remoteDesktops.filter((item) => item.id !== id)
    return { draft: { ...state, remoteDesktops: ensureDefault(remaining, 'isDefault') } }
  }
  const blockedBy: { kind: 'ssh' | 'remote_desktop'; id: string }[] = [
    ...state.ssh
      .filter((item) => item.id !== id && item.draft.jump_ssh_profile_id.trim() === id)
      .map((item) => ({ kind: 'ssh' as const, id: item.id })),
    ...state.remoteDesktops
      .filter((item) => item.draft.route === 'ssh_tunnel' && item.draft.ssh_profile_id.trim() === id)
      .map((item) => ({ kind: 'remote_desktop' as const, id: item.id })),
  ]
  // 活跃路由存在依赖时保留整份草稿；删除操作不能悄悄修改其他连接的路线。
  if (blockedBy.length > 0) return { draft: state, blockedBy }
  const remaining = state.ssh.filter((item) => item.id !== id)
  return { draft: { ...state, ssh: ensureDefault(ensureDefault(remaining, 'isDefault'), 'fileIsDefault') } }
}

export function setHostCreationDefault(
  state: HostCreationDraft,
  kind: HostCreationConnectionKind,
  id: string,
): HostCreationDraft {
  if (kind === 'remote_desktop') {
    if (!state.remoteDesktops.some((item) => item.id === id)) return state
    return { ...state, remoteDesktops: state.remoteDesktops.map((item) => ({ ...item, isDefault: item.id === id })) }
  }
  if (!state.ssh.some((item) => item.id === id)) return state
  const field = kind === 'ssh' ? 'isDefault' : 'fileIsDefault'
  return { ...state, ssh: state.ssh.map((item) => ({ ...item, [field]: item.id === id })) }
}

function ensureDefault<T extends { id: string }>(items: T[], field: keyof T): T[] {
  if (items.length === 0 || items.some((item) => item[field])) return items
  return items.map((item, index) => index === 0 ? { ...item, [field]: true } : item)
}
