import type { AuthMethod, HostGroup } from '#entities/host'
import {
  sortHostAssets,
  type HostAsset,
} from '#entities/host-asset'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'

export type HostDirectoryDefaultSSHResolution = 'resolved' | 'missing' | 'ambiguous'

export interface HostDirectoryItem extends HostAsset {
  defaultSSHProfile: SSHAccessProfile | null
  defaultSSHResolution: HostDirectoryDefaultSSHResolution
}

export interface HostDirectoryCatalogFilters {
  groupId: string
  tags: string[]
  authMethods: AuthMethod[]
}

export interface HostDirectoryTagOption {
  key: string
  label: string
  count: number
}

export interface HostDirectoryGroup {
  id: string
  name: string
  items: HostDirectoryItem[]
}

export function buildHostDirectoryItems(
  assets: HostAsset[],
  sshProfiles: SSHAccessProfile[],
): HostDirectoryItem[] {
  const defaultsByHost = new Map<string, SSHAccessProfile[]>()
  for (const profile of sshProfiles) {
    if (!profile.is_default) continue
    const defaults = defaultsByHost.get(profile.host_id) ?? []
    defaults.push(profile)
    defaultsByHost.set(profile.host_id, defaults)
  }
  return sortHostAssets(assets).map((asset) => {
    const defaults = defaultsByHost.get(asset.id) ?? []
    return {
      ...asset,
      tags: [...(asset.tags ?? [])],
      defaultSSHProfile: defaults.length === 1 ? defaults[0] ?? null : null,
      defaultSSHResolution: defaults.length === 1
        ? 'resolved'
        : defaults.length === 0
          ? 'missing'
          : 'ambiguous',
    }
  })
}

export function buildHostDirectoryTagOptions(items: HostDirectoryItem[]) {
  const options = new Map<string, HostDirectoryTagOption>()
  for (const item of items) {
    const seen = new Set<string>()
    for (const rawTag of item.tags ?? []) {
      const label = rawTag.trim()
      const key = hostDirectoryTagKey(label)
      if (!label || seen.has(key)) continue
      seen.add(key)
      const existing = options.get(key)
      if (existing) {
        existing.count += 1
      } else {
        options.set(key, { key, label, count: 1 })
      }
    }
  }
  return Array.from(options.values()).sort((left, right) => left.label.localeCompare(right.label))
}

export function filterHostDirectoryCatalog(
  items: HostDirectoryItem[],
  groups: HostGroup[],
  query: string,
  filters: HostDirectoryCatalogFilters,
) {
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const selectedTags = filters.tags.map(hostDirectoryTagKey)
  const groupsById = new Map(groups.map((group) => [group.id, group.name]))
  return items.filter((item) => {
    if (filters.groupId && item.group_id !== filters.groupId) return false
    const ssh = item.defaultSSHProfile
    if (filters.authMethods.length > 0 && (!ssh || !filters.authMethods.includes(ssh.auth_method))) {
      return false
    }
    const tagKeys = new Set((item.tags ?? []).map(hostDirectoryTagKey))
    if (selectedTags.length > 0 && !selectedTags.every((tag) => tagKeys.has(tag))) return false
    if (tokens.length === 0) return true
    const searchable = [
      item.name,
      item.note ?? '',
      groupsById.get(item.group_id) ?? '',
      (item.tags ?? []).join(' '),
      ssh?.name ?? '',
      ssh?.address ?? '',
      ssh?.username ?? '',
      ssh ? String(ssh.port) : '',
    ].join(' ').toLocaleLowerCase()
    return tokens.every((token) => searchable.includes(token))
  })
}

export function groupHostDirectoryItems(
  items: HostDirectoryItem[],
  groups: HostGroup[],
  ungroupedLabel: string,
): HostDirectoryGroup[] {
  const knownGroups = new Set(groups.map((group) => group.id))
  const grouped = new Map<string, HostDirectoryItem[]>()
  for (const item of items) {
    const groupId = item.group_id && knownGroups.has(item.group_id) ? item.group_id : ''
    grouped.set(groupId, [...(grouped.get(groupId) ?? []), item])
  }
  const sections = [...groups]
    .sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name))
    .map((group) => ({ id: group.id, name: group.name, items: grouped.get(group.id) ?? [] }))
    .filter((section) => section.items.length > 0)
  const ungrouped = grouped.get('') ?? []
  return ungrouped.length > 0
    ? [{ id: '', name: ungroupedLabel, items: ungrouped }, ...sections]
    : sections
}

export function formatSSHProfileEndpoint(profile: SSHAccessProfile) {
  const address = profile.address.includes(':') && !profile.address.startsWith('[')
    ? `[${profile.address}]`
    : profile.address
  return `${profile.username}@${address}:${profile.port}`
}

export function hostDirectoryTagKey(value: string) {
  return value.trim().toLocaleLowerCase()
}
