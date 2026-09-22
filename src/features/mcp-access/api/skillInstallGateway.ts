import type { SkillInstallBridge } from '#common/contracts'
import { getTermousBridge } from '#shared/bridge'

export function getSkillInstallGateway(): SkillInstallBridge | null {
  return getTermousBridge()?.skillInstall ?? null
}
