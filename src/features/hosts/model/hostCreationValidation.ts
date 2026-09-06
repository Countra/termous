import { validateFileAccessProfileMetadataInput } from '#entities/file-access-profile'
import { validateHostAssetInput } from '#entities/host-asset'
import { validateSSHAccessProfileDraft } from '#entities/ssh-access-profile'
import { validateVNCAccessProfileDraft, validateVNCTargetAuthDraft } from '#features/manage-remote-desktop'
import type {
  HostCreationDependencies,
  HostCreationDraft,
  HostCreationIssue,
  HostCreationValidation,
} from './hostCreationTypes.ts'

export function validateHostCreationDraft(
  state: HostCreationDraft,
  dependencies: HostCreationDependencies,
): HostCreationValidation {
  const issues: HostCreationIssue[] = []
  const addErrors = (kind: HostCreationIssue['kind'], id: string | undefined, errors: object) => {
    for (const [field, code] of Object.entries(errors)) {
      if (typeof code === 'string') issues.push({ kind, ...(id ? { id } : {}), field, code })
    }
  }
  addErrors('asset', undefined, validateHostAssetInput(state.host))
  const localSSHIds = new Set(state.ssh.map((item) => item.id))
  const credentials = new Map(dependencies.credentials.map((item) => [item.id, item]))
  const proxyIds = new Set(dependencies.proxies.map((item) => item.id))
  const jumps = new Map<string, string>([
    ...dependencies.sshProfiles.map((item) => [item.id, item.jump_ssh_profile_id?.trim() ?? ''] as const),
    ...state.ssh.map((item) => [item.id, item.draft.jump_ssh_profile_id.trim()] as const),
  ])
  for (const item of state.ssh) {
    const errors: Record<string, string | undefined> = {
      ...(!item.draft.name.trim() ? { name: 'required' } : {}),
      ...validateSSHAccessProfileDraft(item.draft, item.id),
    }
    const credentialId = item.draft.credential_id.trim()
    const credential = credentials.get(credentialId)
    if (credentialId && !credential) errors.credential_id = 'missing'
    else if (credential && credential.type !== item.draft.auth_method) errors.credential_id = 'type_mismatch'
    if (item.draft.proxy_id.trim() && !proxyIds.has(item.draft.proxy_id.trim())) errors.proxy_id = 'missing'
    const jumpId = item.draft.jump_ssh_profile_id.trim()
    if (jumpId && jumpId !== item.id) {
      if (!jumps.has(jumpId)) errors.jump_ssh_profile_id = 'missing'
      else if (hasJumpCycle(item.id, jumps)) errors.jump_ssh_profile_id = 'cycle'
      else if (jumps.get(jumpId)) errors.jump_ssh_profile_id = 'nested_jump'
      else if (Array.from(jumps.values()).includes(item.id)) errors.jump_ssh_profile_id = 'consumer_route_locked'
    }
    addErrors('ssh', item.id, errors)
    addErrors('file', item.id, validateFileAccessProfileMetadataInput({ name: item.fileName }))
  }
  for (const item of state.remoteDesktops) {
    // 隧道端点属于新主机，只能引用同一草稿的 SSH；其他主机仍可作为 SSH 跳板。
    const normalizedReference = { ...item.draft, ssh_profile_id: item.draft.ssh_profile_id.trim() }
    addErrors('remote_desktop', item.id, validateVNCAccessProfileDraft(normalizedReference, localSSHIds))
    addErrors('remote_desktop', item.id, { target_auth_password: validateVNCTargetAuthDraft(item.targetAuthDraft) })
  }
  validateDefaults(state, issues)
  return {
    issues,
    firstIssue: issues[0],
    incomplete: {
      ssh: issueIds(issues, 'ssh'),
      file: issueIds(issues, 'file'),
      remote_desktop: issueIds(issues, 'remote_desktop'),
    },
  }
}

function hasJumpCycle(start: string, jumps: ReadonlyMap<string, string>) {
  const seen = new Set<string>()
  let current = start
  while (current) {
    if (seen.has(current)) return true
    seen.add(current)
    current = jumps.get(current) ?? ''
  }
  return false
}

function validateDefaults(state: HostCreationDraft, issues: HostCreationIssue[]) {
  const groups = [
    { kind: 'ssh' as const, items: state.ssh.map((item) => ({ id: item.id, selected: item.isDefault })) },
    { kind: 'file' as const, items: state.ssh.map((item) => ({ id: item.id, selected: item.fileIsDefault })) },
    { kind: 'remote_desktop' as const, items: state.remoteDesktops.map((item) => ({ id: item.id, selected: item.isDefault })) },
  ]
  for (const { kind, items } of groups) {
    if (items.length > 0 && items.filter((item) => item.selected).length !== 1) {
      issues.push({ kind, id: items[0].id, field: 'is_default', code: 'exactly_one' })
    }
  }
}

function issueIds(issues: HostCreationIssue[], kind: HostCreationIssue['kind']) {
  return [...new Set(issues.filter((issue) => issue.kind === kind && issue.id).map((issue) => issue.id!))]
}
