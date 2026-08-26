export type HostLauncherIntent = 'terminal' | 'files' | 'remote_desktop'

export type HostLauncherActionId =
  | 'connect'
  | 'editHost'
  | 'openFiles'
  | 'openForward'
  | 'openRemoteDesktop'

export interface HostLauncherActionPlan {
  primary: 'connect' | 'openFiles' | 'openRemoteDesktop'
  shortcuts: readonly [HostLauncherActionId, HostLauncherActionId, HostLauncherActionId]
}

const terminalActionPlan: HostLauncherActionPlan = {
  primary: 'connect',
  shortcuts: ['editHost', 'openFiles', 'openForward'],
}

const filesActionPlan: HostLauncherActionPlan = {
  primary: 'openFiles',
  shortcuts: ['editHost', 'connect', 'openForward'],
}

const remoteDesktopActionPlan: HostLauncherActionPlan = {
  primary: 'openRemoteDesktop',
  shortcuts: ['editHost', 'connect', 'openFiles'],
}

export function hostLauncherActionPlan(intent: HostLauncherIntent): HostLauncherActionPlan {
  if (intent === 'files') return filesActionPlan
  if (intent === 'remote_desktop') return remoteDesktopActionPlan
  return terminalActionPlan
}
