import { App } from 'antd'
import type { TFunction } from 'i18next'
import { TermousApiError } from '../../api/client'

export function displayAliasShell(shell: string | undefined) {
  const normalized = shell?.trim()
  return normalized || 'Shell'
}

const aliasErrorTranslationKeys: Record<string, string> = {
  SHELL_ALIAS_INVALID: 'workbench.aliases.errors.invalid',
  SHELL_ALIAS_NOT_FOUND: 'workbench.aliases.errors.notFound',
  SHELL_ALIAS_NAME_CONFLICT: 'workbench.aliases.errors.nameConflict',
  SHELL_ALIAS_FILE_CONFLICT: 'workbench.aliases.errors.fileConflict',
  SHELL_ALIAS_PERMISSION_DENIED: 'workbench.aliases.errors.permissionDenied',
  SHELL_ALIAS_UNSUPPORTED: 'workbench.aliases.errors.unsupported',
  SHELL_ALIAS_REMOTE_FAILED: 'workbench.aliases.errors.remoteFailed',
  SHELL_ALIAS_TIMEOUT: 'workbench.aliases.errors.timeout',
  REQUEST_TIMEOUT: 'workbench.aliases.errors.timeout',
  NETWORK_ERROR: 'workbench.aliases.errors.network',
  SESSION_NOT_READY: 'workbench.aliases.errors.sessionUnavailable',
  SESSION_NOT_FOUND: 'workbench.aliases.errors.sessionUnavailable',
  SESSION_CLOSED: 'workbench.aliases.errors.sessionUnavailable',
  REQUEST_IN_PROGRESS: 'workbench.aliases.errors.requestInProgress',
}

export function aliasErrorDescription(code: string, message: string, t: TFunction) {
  const translationKey = aliasErrorTranslationKeys[code]
  if (translationKey) {
    return t(translationKey)
  }
  return message || t('workbench.aliases.operationFailed')
}

export function showAliasError(
  error: unknown,
  t: TFunction,
  notification: ReturnType<typeof App.useApp>['notification'],
) {
  if (error instanceof TermousApiError && error.code === 'REQUEST_ABORTED') {
    return
  }
  const code = error instanceof TermousApiError ? error.code : ''
  const message = error instanceof Error ? error.message : ''
  notification.error({
    title: t('workbench.aliases.operationFailed'),
    description: aliasErrorDescription(code, message, t),
    duration: 4,
    role: 'alert',
    className: 'termous-notification',
  })
}
