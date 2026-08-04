import type { Host, HostGroup } from '../../types/domain'

export interface AliasSyncHostSection {
  id: string
  name: string
  hosts: Host[]
}

export function orderAliasSyncHosts(
  hosts: readonly Host[],
  groups: readonly HostGroup[],
  sourceHostId: string | undefined,
) {
  const candidates = hosts.filter((host) => host.id !== sourceHostId)
  const orderedGroups = [...groups].sort((left, right) => (
    left.sort_order - right.sort_order || left.name.localeCompare(right.name)
  ))
  const knownGroupIds = new Set(orderedGroups.map((group) => group.id))
  return [
    ...orderedGroups.flatMap((group) => candidates.filter((host) => host.group_id === group.id)),
    ...candidates.filter((host) => !host.group_id || !knownGroupIds.has(host.group_id)),
  ]
}

export function groupAliasSyncHosts(
  hosts: readonly Host[],
  groups: readonly HostGroup[],
): AliasSyncHostSection[] {
  const orderedGroups = [...groups].sort((left, right) => (
    left.sort_order - right.sort_order || left.name.localeCompare(right.name)
  ))
  const knownGroupIds = new Set(orderedGroups.map((group) => group.id))
  const sections = orderedGroups
    .map((group) => ({
      id: group.id,
      name: group.name,
      hosts: hosts.filter((host) => host.group_id === group.id),
    }))
    .filter((section) => section.hosts.length > 0)
  const ungrouped = hosts.filter((host) => !host.group_id || !knownGroupIds.has(host.group_id))
  if (ungrouped.length > 0) {
    sections.push({ id: '', name: '', hosts: ungrouped })
  }
  return sections
}

export function orderAliasSyncSelectionIds<T extends { id: string }>(
  items: readonly T[],
  selectedIds: Iterable<string>,
) {
  const selected = new Set(selectedIds)
  return items.filter((item) => selected.has(item.id)).map((item) => item.id)
}

export function isAliasSyncHostSelectable(
  host: Pick<Host, 'credential_id'>,
  credentialIds: ReadonlySet<string>,
) {
  return Boolean(host.credential_id && credentialIds.has(host.credential_id))
}
