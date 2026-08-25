import { sortFileAccessProfiles } from '#entities/file-access-profile'
import { sortRemoteDesktopAccessProfiles } from '#entities/remote-desktop'
import { sortSSHAccessProfiles } from '#entities/ssh-access-profile'
import type {
  HostAccessCatalog,
  HostAsset,
  HostAssetInput,
  HostAssetValidationErrors,
} from './types.ts'

const MAX_HOST_ASSET_NAME_LENGTH = 80

export function hostAssetToInput(asset: HostAsset): HostAssetInput {
  return {
    name: asset.name,
    platform: asset.platform ?? 'linux',
    icon_id: asset.icon_id ?? '',
    group_id: asset.group_id,
    tags: [...(asset.tags ?? [])],
    favorite: Boolean(asset.favorite),
    note: asset.note ?? '',
  }
}

export function normalizeHostAssetInput(input: HostAssetInput): HostAssetInput {
  return {
    name: input.name.trim(),
    platform: input.platform,
    icon_id: input.icon_id.trim(),
    group_id: input.group_id.trim(),
    tags: normalizeAssetTags(input.tags),
    favorite: Boolean(input.favorite),
    note: input.note.trim(),
  }
}

function normalizeAssetTags(tags: string[]) {
  const result: string[] = []
  const seen = new Set<string>()
  for (const tag of tags) {
    const value = tag.trim().replace(/\s+/g, ' ')
    const key = value.toLocaleLowerCase()
    if (!value || seen.has(key)) {
      continue
    }
    seen.add(key)
    result.push(value)
  }
  return result
}

export function hostAssetInputsEqual(left: HostAssetInput, right: HostAssetInput) {
  return JSON.stringify(normalizeHostAssetInput(left)) === JSON.stringify(normalizeHostAssetInput(right))
}

export function validateHostAssetInput(input: HostAssetInput): HostAssetValidationErrors {
  const name = input.name.trim()
  if (!name) {
    return { name: 'required' }
  }
  if (Array.from(name).length > MAX_HOST_ASSET_NAME_LENGTH) {
    return { name: 'too_long' }
  }
  return {}
}

export function sortHostAssets(assets: HostAsset[]) {
  return [...assets].sort((left, right) => (
    left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
  ))
}

export function findHostAsset(assets: HostAsset[], id: string) {
  return assets.find((asset) => asset.id === id)
}

export function normalizeHostAccessCatalog(catalog: HostAccessCatalog): HostAccessCatalog {
  return {
    host: {
      ...catalog.host,
      tags: [...(catalog.host.tags ?? [])],
    },
    ssh: sortSSHAccessProfiles(catalog.ssh ?? []),
    files: sortFileAccessProfiles(catalog.files ?? []),
    remote_desktops: sortRemoteDesktopAccessProfiles(catalog.remote_desktops ?? []),
  }
}
