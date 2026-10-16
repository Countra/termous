import type {
  TermousBridge,
  TermousUpdateWindowBridge,
  RemoteWindowBridge,
  DesktopAutomationBridge,
  DetachedWindowBridge,
} from '#common/contracts'

type BridgeWindow = Window & {
  termousDetached?: DetachedWindowBridge
  termous?: TermousBridge
  termousUpdate?: TermousUpdateWindowBridge
  termousRemote?: RemoteWindowBridge
  termousDesktopAutomation?: DesktopAutomationBridge
}

export function getDetachedWindowBridge(): DetachedWindowBridge | null {
  return typeof window === 'undefined' ? null : (window as BridgeWindow).termousDetached ?? null
}

export function getDesktopAutomationBridge(): DesktopAutomationBridge | null {
  return typeof window === 'undefined' ? null : (window as BridgeWindow).termousDesktopAutomation ?? null
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
