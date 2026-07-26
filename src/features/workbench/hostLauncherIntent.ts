import type { PageKey } from '../../types/domain'

export type HostLauncherIntent = 'terminal' | 'files'

export type HostLauncherActionId = 'connect' | 'editHost' | 'openFiles' | 'openForward'

export interface HostLauncherActionPlan {
  primary: 'connect' | 'openFiles'
  shortcuts: readonly ['editHost', 'openFiles' | 'connect', 'openForward']
}

const terminalActionPlan: HostLauncherActionPlan = {
  primary: 'connect',
  shortcuts: ['editHost', 'openFiles', 'openForward'],
}

const filesActionPlan: HostLauncherActionPlan = {
  primary: 'openFiles',
  shortcuts: ['editHost', 'connect', 'openForward'],
}

export function hostLauncherActionPlan(intent: HostLauncherIntent): HostLauncherActionPlan {
  return intent === 'files' ? filesActionPlan : terminalActionPlan
}

export function hostLauncherIntentForPage(page: PageKey): HostLauncherIntent {
  return page === 'files' ? 'files' : 'terminal'
}
