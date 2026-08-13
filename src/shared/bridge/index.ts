import type {
  TermousBridge,
  TermousUpdateWindowBridge,
} from '#common/contracts'

type BridgeWindow = Window & {
  termous?: TermousBridge
  termousUpdate?: TermousUpdateWindowBridge
}

export function getTermousBridge(): TermousBridge | null {
  if (typeof window === 'undefined') {
    return null
  }
  return (window as BridgeWindow).termous ?? null
}

export function getTermousUpdateBridge(): TermousUpdateWindowBridge | null {
  if (typeof window === 'undefined') {
    return null
  }
  return (window as BridgeWindow).termousUpdate ?? null
}
