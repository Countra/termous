import type { HostInput } from '#entities/host'
import type { HostAssetInput } from '#entities/host-asset'
import type {
  SSHAccessProfile,
  SSHAccessProfileDraft,
} from '#entities/ssh-access-profile'

export function projectHostAssetDraft(input: HostInput): HostAssetInput {
  return {
    name: input.name,
    platform: input.platform,
    icon_id: input.icon_id,
    group_id: input.group_id,
    tags: [...input.tags],
    favorite: input.favorite,
    note: input.note,
  }
}

export function mergeHostAssetDraft(
  input: HostInput,
  asset: HostAssetInput,
): HostInput {
  return {
    ...input,
    name: asset.name,
    platform: asset.platform,
    icon_id: asset.icon_id,
    group_id: asset.group_id,
    tags: [...asset.tags],
    favorite: asset.favorite,
    note: asset.note,
  }
}

export function selectInitialJumpProfiles(profiles: SSHAccessProfile[]) {
  const defaultsByHost = new Map<string, SSHAccessProfile[]>()
  for (const profile of profiles) {
    if (!profile.is_default) continue
    defaultsByHost.set(profile.host_id, [
      ...(defaultsByHost.get(profile.host_id) ?? []),
      profile,
    ])
  }
  return Array.from(defaultsByHost.values())
    .filter((defaults) => defaults.length === 1)
    .map(([profile]) => profile!)
    .sort((left, right) => (
      left.name.localeCompare(right.name)
      || left.host_id.localeCompare(right.host_id)
      || left.id.localeCompare(right.id)
    ))
}

export function projectInitialSSHProfileDraft(
  input: HostInput,
  jumpProfiles: SSHAccessProfile[],
): SSHAccessProfileDraft {
  return {
    name: input.name,
    address: input.address,
    port: input.port,
    username: input.username,
    auth_method: input.auth_method,
    credential_id: input.credential_id,
    proxy_id: input.proxy_id,
    jump_ssh_profile_id: jumpProfiles.find(
      (profile) => profile.host_id === input.jump_host_id,
    )?.id ?? '',
    fingerprint: '',
    fingerprint_policy: input.fingerprint_policy,
  }
}

export function mergeInitialSSHProfileDraft(
  input: HostInput,
  profile: SSHAccessProfileDraft,
  jumpProfiles: SSHAccessProfile[],
): HostInput {
  return {
    ...input,
    address: profile.address,
    port: profile.port ?? 0,
    username: profile.username,
    auth_method: profile.auth_method,
    credential_id: profile.credential_id,
    proxy_id: profile.proxy_id,
    jump_host_id: jumpProfiles.find(
      (candidate) => candidate.id === profile.jump_ssh_profile_id,
    )?.host_id ?? '',
    fingerprint_policy: profile.fingerprint_policy,
  }
}
