import type { LoginItemBridge } from '#common/contracts'
import { getTermousBridge } from '#shared/bridge'

export function getLoginItemGateway(): LoginItemBridge | null {
  return getTermousBridge()?.loginItem ?? null
}
