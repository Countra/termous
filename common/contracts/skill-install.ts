export type SkillInstallClient = 'codex' | 'claude-code' | 'custom'
export type SkillInstallPolicy = 'skip' | 'replace'
export type SkillInstallError =
  | 'invalid_request' | 'invalid_directory' | 'unsafe_path' | 'bundle_unavailable'
  | 'permission_denied' | 'disk_full' | 'target_changed' | 'plan_expired'
  | 'busy' | 'io_error' | 'cleanup_failed' | 'recovery_failed'

export interface SkillInstallPlan {
  id: string
  client: SkillInstallClient
  base_directory: string
  target_directory: string
  skills: Array<{ name: string; exists: boolean }>
}

export interface SkillInstallResult {
  target_directory: string
  items: Array<{
    name: string
    status: 'installed' | 'skipped' | 'failed'
    error?: SkillInstallError
    recovery_path?: string
  }>
}

export type SkillInstallResponse<T> = { ok: true; value: T } | { ok: false; error: SkillInstallError }

export interface SkillInstallBridge {
  selectDirectory: (client: SkillInstallClient) => Promise<SkillInstallResponse<SkillInstallPlan | null>>
  install: (request: { plan_id: string; policy: SkillInstallPolicy }) => Promise<SkillInstallResponse<SkillInstallResult>>
}

export const skillInstallIPCChannels = {
  selectDirectory: 'skills-install:select-directory',
  install: 'skills-install:install',
} as const
