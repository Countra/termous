import type {
  TermousBridge,
  TermousUpdateWindowBridge,
  RemoteWindowBridge,
  DesktopWindowBridge,
} from '#common/contracts'

type BridgeWindow = Window & {
  termous?: TermousBridge
  termousUpdate?: TermousUpdateWindowBridge
  termousRemote?: RemoteWindowBridge
  termousDesktop?: DesktopWindowBridge
}

export function getDesktopWindowBridge(): DesktopWindowBridge | null {
  return typeof window === 'undefined' ? null : (window as BridgeWindow).termousDesktop ?? null
}

export function getRemoteWindowBridge(): RemoteWindowBridge | null {
  return typeof window === 'undefined' ? null : (window as BridgeWindow).termousRemote ?? null
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
