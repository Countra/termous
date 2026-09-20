import type { TFunction } from 'i18next'

export const auditScopes = ['hosts', 'sessions', 'files', 'commands', 'forwarding', 'snippets', 'remoteops', 'skills', 'agent', 'access', 'unknown']

// 未登记操作保留原始标识，避免把新事件误映射为已有操作。
export function auditActionLabel(t: TFunction, action: string): string {
  return t(`audit.actions.${action.replace(/\./g, '_')}`, { defaultValue: action })
}

export function auditScopeLabel(t: TFunction, scope: string): string {
  return t(`audit.scopes.${scope}`, { defaultValue: scope })
}
