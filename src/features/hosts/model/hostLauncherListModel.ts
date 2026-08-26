import type { AuthMethod, HostGroup, HostReachability } from '#entities/host'
import type { HostAsset } from '#entities/host-asset'
import type { HostDirectoryItem } from './hostDirectory.ts'

export type LauncherFilter = 'all' | 'recent' | 'online' | 'favorite'
export type LauncherPlatformFilter = 'all' | HostAsset['platform']
export type LauncherAuthFilter = 'all' | AuthMethod
export type LauncherGroupFilter = 'all' | '__ungrouped' | string
export type HostLauncherTranslate = (
  key: string,
  options?: Record<string, string | number>,
) => string

export interface HostLauncherGroup {
  id: string
  name: string
  hosts: HostDirectoryItem[]
  order: number
}

export interface HostLauncherTagOption {
  key: string
  label: string
  count: number
}

export type LatencyLevel = 'unknown' | 'low' | 'medium' | 'high'

export function filterHosts(
  hosts: HostDirectoryItem[],
  groupsById: Map<string, string>,
  reachabilityByHostId: Record<string, HostReachability>,
  query: string,
  filter: LauncherFilter,
  platformFilter: LauncherPlatformFilter,
  groupFilter: LauncherGroupFilter,
  authFilter: LauncherAuthFilter,
  selectedTags: string[],
) {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const selectedTagKeys = selectedTags.map(tagKey)
  const filtered = hosts.filter((host) => {
    const candidateReachability = reachabilityByHostId[host.id]
    const reachability = host.defaultSSHProfile
      && candidateReachability?.ssh_profile_id === host.defaultSSHProfile.id
      ? candidateReachability
      : undefined
    const reachabilityStatus = reachability?.status ?? 'unknown'
    if (platformFilter !== 'all' && host.platform !== platformFilter) {
      return false
    }
    if (groupFilter !== 'all' && (host.group_id || '__ungrouped') !== groupFilter) {
      return false
    }
    const ssh = host.defaultSSHProfile
    if (authFilter !== 'all' && ssh?.auth_method !== authFilter) {
      return false
    }
    if (filter === 'online' && reachabilityStatus !== 'online' && reachabilityStatus !== 'checking') {
      return false
    }
    if (filter === 'recent' && timestamp(host.last_accessed_at) <= 0) {
      return false
    }
    if (filter === 'favorite' && !host.favorite) {
      return false
    }
    const hostTags = host.tags ?? []
    const hostTagKeys = new Set(hostTags.map(tagKey))
    if (selectedTagKeys.length > 0 && !selectedTagKeys.every((tag) => hostTagKeys.has(tag))) {
      return false
    }
    if (tokens.length === 0) {
      return true
    }
    const searchable = [
      host.name,
      ssh?.name ?? '',
      ssh?.address ?? '',
      ssh?.username ?? '',
      ssh ? String(ssh.port) : '',
      host.note ?? '',
      groupsById.get(host.group_id) ?? '',
      hostTags.join(' '),
    ].join(' ').toLowerCase()
    return tokens.every((token) => searchable.includes(token))
  })
  return filtered.sort((left, right) => {
    const recentDelta = timestamp(right.last_accessed_at) - timestamp(left.last_accessed_at)
    if (filter === 'recent') {
      return recentDelta || left.name.localeCompare(right.name)
    }
    if (left.favorite !== right.favorite) {
      return left.favorite ? -1 : 1
    }
    if (recentDelta !== 0) {
      return recentDelta
    }
    return left.name.localeCompare(right.name)
  })
}

export function groupHosts(
  hosts: HostDirectoryItem[],
  groups: HostGroup[],
  fallbackGroupName: string,
) {
  const groupNames = new Map(groups.map((group) => [group.id, group.name]))
  const buckets = new Map<string, HostLauncherGroup>()
  for (const host of hosts) {
    const id = host.group_id || '__ungrouped'
    if (!buckets.has(id)) {
      const groupIndex = groups.findIndex((group) => group.id === host.group_id)
      buckets.set(id, {
        id,
        name: groupNames.get(host.group_id) || fallbackGroupName,
        hosts: [],
        order: groupIndex >= 0 ? groupIndex : Number.MAX_SAFE_INTEGER,
      })
    }
    buckets.get(id)?.hosts.push(host)
  }
  return Array.from(buckets.values()).sort((left, right) => {
    if (left.order !== right.order) {
      return left.order - right.order
    }
    return left.name.localeCompare(right.name)
  })
}

export function buildGroupFilterOptions(
  hosts: HostDirectoryItem[],
  groups: HostGroup[],
  fallbackGroupName: string,
  allLabel: string,
) {
  const options = [
    { value: 'all', label: allLabel },
    ...groups.map((group) => ({ value: group.id, label: group.name })),
  ]
  if (hosts.some((host) => !host.group_id)) {
    options.push({ value: '__ungrouped', label: fallbackGroupName })
  }
  return options
}

export function buildTagOptions(hosts: HostDirectoryItem[]) {
  const map = new Map<string, HostLauncherTagOption>()
  for (const host of hosts) {
    const seen = new Set<string>()
    for (const rawTag of host.tags ?? []) {
      const label = rawTag.trim()
      const key = tagKey(label)
      if (!label || seen.has(key)) {
        continue
      }
      seen.add(key)
      const existing = map.get(key)
      if (existing) {
        existing.count += 1
      } else {
        map.set(key, { key, label, count: 1 })
      }
    }
  }
  return Array.from(map.values()).sort((left, right) => left.label.localeCompare(right.label))
}

export function tagKey(value: string) {
  return value.trim().toLowerCase()
}

export function formatDateTime(value: string | undefined, fallback: string) {
  if (!value) {
    return fallback
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return fallback
  }
  return date.toLocaleString([], {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function reachabilityTooltip(
  state: HostReachability | undefined,
  t: HostLauncherTranslate,
  usesProxy = false,
) {
  const status = state?.status ?? 'unknown'
  let label: string
  if (status === 'online' && state?.latency_ms !== undefined) {
    label = t('workbench.hostLauncher.reachabilityTooltip.online', { latency: state.latency_ms })
  } else if ((status === 'offline' || status === 'unavailable') && state?.error_message) {
    label = state.error_message
  } else {
    label = t(`workbench.hostLauncher.reachabilityTooltip.${status}`)
  }
  return usesProxy
    ? `${label} · ${t('proxies.reachabilityDirectHint')}`
    : label
}

export function formatReachabilityLatency(
  state: HostReachability | undefined,
  t: HostLauncherTranslate,
) {
  if (!state || state.status === 'unknown') {
    return t('fields.none')
  }
  if (state.status === 'checking') {
    return t('workbench.hostLauncher.reachability.checking')
  }
  if (state.status !== 'online' || state.latency_ms === undefined) {
    return t('workbench.hostLauncher.reachability.offline')
  }
  return t('workbench.hostLauncher.latencyValue', { latency: state.latency_ms })
}

export function latencyLevel(state: HostReachability | undefined): LatencyLevel {
  if (!state || state.status !== 'online' || state.latency_ms === undefined) {
    return 'unknown'
  }
  if (state.latency_ms <= 80) {
    return 'low'
  }
  if (state.latency_ms <= 180) {
    return 'medium'
  }
  return 'high'
}

export function latencySignalLabel(
  state: HostReachability | undefined,
  t: HostLauncherTranslate,
) {
  const level = latencyLevel(state)
  if (level === 'unknown') {
    return t('workbench.hostLauncher.latencyLevels.unknown')
  }
  return t('workbench.hostLauncher.latencyLevels.value', {
    level: t(`workbench.hostLauncher.latencyLevels.${level}`),
    latency: state?.latency_ms ?? 0,
  })
}

function timestamp(value?: string) {
  if (!value) {
    return 0
  }
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}
