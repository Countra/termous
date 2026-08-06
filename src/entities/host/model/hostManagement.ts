import type { AuthMethod, Host, HostGroup, HostInput } from './types.ts'

export interface HostTagOption {
  key: string
  label: string
  count: number
}

export interface HostCatalogFilters {
  groupId: string
  tags: string[]
  authMethods: AuthMethod[]
}

export interface HostValidationErrors {
  address?: string
  port?: string
  username?: string
  credentialId?: string
  proxyId?: string
}

export interface HostGroupSection {
  id: string
  name: string
  hosts: Host[]
}

export const HOST_ICON_ACCEPT = '.png,.jpg,.jpeg,.svg,.ico,image/png,image/jpeg,image/svg+xml,image/x-icon,image/vnd.microsoft.icon'
export const MAX_HOST_ICON_BYTES = 5 * 1024 * 1024

export function createBlankHostInput(): HostInput {
  return {
    name: '',
    platform: 'linux',
    icon_id: '',
    group_id: '',
    address: '',
    port: 22,
    username: '',
    auth_method: 'password',
    credential_id: '',
    jump_host_id: '',
    proxy_id: '',
    tags: [],
    favorite: false,
    fingerprint_policy: 'confirm_on_change',
    note: '',
  }
}

export function normalizeHostInput(input: HostInput): HostInput {
  return {
    ...input,
    name: input.name.trim(),
    address: input.address.trim(),
    username: input.username.trim(),
    group_id: input.group_id.trim(),
    credential_id: input.credential_id.trim(),
    jump_host_id: input.jump_host_id.trim(),
    proxy_id: input.proxy_id.trim(),
    tags: normalizeHostTags(input.tags),
    note: input.note.trim(),
  }
}

export function hostInputsEqual(left: HostInput, right: HostInput) {
  return JSON.stringify(normalizeHostInput(left)) === JSON.stringify(normalizeHostInput(right))
}

export function validateHostInput(input: HostInput, messages: HostValidationErrors): HostValidationErrors {
  const errors: HostValidationErrors = {}
  if (!input.address.trim()) {
    errors.address = messages.address
  }
  if (!input.username.trim()) {
    errors.username = messages.username
  }
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    errors.port = messages.port
  }
  if (!input.credential_id.trim()) {
    errors.credentialId = messages.credentialId
  }
  return errors
}

export function normalizeHostTags(tags: string[]) {
  const result: string[] = []
  const seen = new Set<string>()
  for (const tag of tags) {
    const clean = tag.trim().replace(/\s+/g, ' ')
    const key = hostTagKey(clean)
    if (!clean || seen.has(key)) {
      continue
    }
    seen.add(key)
    result.push(clean)
  }
  return result
}

export function normalizeGroupName(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

export function hostTagKey(value: string) {
  return value.trim().toLocaleLowerCase()
}

export function buildHostTagOptions(hosts: Host[]) {
  const tagMap = new Map<string, HostTagOption>()
  for (const host of hosts) {
    const seenInHost = new Set<string>()
    for (const tag of normalizeHostTags(host.tags ?? [])) {
      const key = hostTagKey(tag)
      if (seenInHost.has(key)) {
        continue
      }
      seenInHost.add(key)
      const existing = tagMap.get(key)
      if (existing) {
        existing.count += 1
      } else {
        tagMap.set(key, { key, label: tag, count: 1 })
      }
    }
  }
  return Array.from(tagMap.values()).sort((left, right) => left.label.localeCompare(right.label))
}

export function filterHosts(hosts: Host[], groups: HostGroup[], query: string, filters: HostCatalogFilters) {
  const tokens = query.trim().split(/\s+/).map((token) => token.toLocaleLowerCase()).filter(Boolean)
  const selectedTagKeys = filters.tags.map(hostTagKey)
  const groupNames = new Map(groups.map((group) => [group.id, group.name]))

  return hosts.filter((host) => {
    if (filters.groupId && host.group_id !== filters.groupId) {
      return false
    }
    if (filters.authMethods.length > 0 && !filters.authMethods.includes(host.auth_method)) {
      return false
    }
    const tags = normalizeHostTags(host.tags ?? [])
    const tagKeys = new Set(tags.map(hostTagKey))
    if (selectedTagKeys.length > 0 && !selectedTagKeys.every((tag) => tagKeys.has(tag))) {
      return false
    }
    if (tokens.length === 0) {
      return true
    }
    const searchable = [
      host.name,
      host.address,
      host.username,
      String(host.port),
      host.note ?? '',
      groupNames.get(host.group_id) ?? '',
      tags.join(' '),
    ].join(' ').toLocaleLowerCase()
    return tokens.every((token) => searchable.includes(token))
  })
}

export function groupHosts(hosts: Host[], groups: HostGroup[], ungroupedLabel: string): HostGroupSection[] {
  const byGroup = new Map<string, Host[]>()
  const knownGroupIds = new Set(groups.map((group) => group.id))
  for (const host of hosts) {
    const groupId = host.group_id && knownGroupIds.has(host.group_id) ? host.group_id : ''
    byGroup.set(groupId, [...(byGroup.get(groupId) ?? []), host])
  }
  const orderedGroups = [...groups].sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name))
  const sections = orderedGroups
    .map((group) => ({ id: group.id, name: group.name, hosts: byGroup.get(group.id) ?? [] }))
    .filter((section) => section.hosts.length > 0)
  const ungroupedHosts = byGroup.get('') ?? []
  return ungroupedHosts.length > 0
    ? [{ id: '', name: ungroupedLabel, hosts: ungroupedHosts }, ...sections]
    : sections
}
