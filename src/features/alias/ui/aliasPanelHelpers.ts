import { App } from 'antd'
import type { TFunction } from 'i18next'
import { TermousApiError } from '#shared/api'
import { termousNotificationClassName } from '#shared/ui'

export function displayAliasShell(shell: string | undefined) {
  const normalized = shell?.trim()
  return normalized || 'Shell'
}

const aliasErrorTranslationKeys: Record<string, string> = {
  SHELL_ALIAS_INVALID: 'workbench.aliases.errors.invalid',
  SHELL_ALIAS_NOT_FOUND: 'workbench.aliases.errors.notFound',
  SHELL_ALIAS_NAME_CONFLICT: 'workbench.aliases.errors.nameConflict',
  SHELL_ALIAS_TEMPLATE_OUTDATED: 'workbench.aliases.errors.templateOutdated',
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
  SHELL_ALIAS_SYNC_IN_PROGRESS: 'workbench.aliases.errors.syncInProgress',
  SHELL_ALIAS_SYNC_NOT_FOUND: 'workbench.aliases.errors.syncNotFound',
  SHELL_ALIAS_SYNC_INVALID_SELECTION: 'workbench.aliases.errors.syncInvalidSelection',
  SHELL_ALIAS_SYNC_SOURCE_CHANGED: 'workbench.aliases.errors.syncSourceChanged',
  SHELL_ALIAS_SYNC_TARGET_CHANGED: 'workbench.aliases.errors.syncTargetChanged',
}

const aliasSyncErrorTranslationKeys: Record<string, string> = {
  VALIDATION_ERROR: 'workbench.aliases.sync.errors.connectionInvalid',
  NOT_FOUND: 'workbench.aliases.sync.errors.connectionNotFound',
  CREDENTIAL_LOCKED: 'workbench.aliases.sync.errors.credentialLocked',
  SSH_AUTH_FAILED: 'workbench.aliases.sync.errors.sshAuthFailed',
  SSH_CONNECT_FAILED: 'workbench.aliases.sync.errors.sshConnectFailed',
  JUMP_HOST_FAILED: 'workbench.aliases.sync.errors.jumpHostFailed',
  PROXY_CONFIG_INVALID: 'connection.proxyError.configInvalid',
  PROXY_AUTH_REQUIRED: 'connection.proxyError.authRequired',
  PROXY_TIMEOUT: 'connection.proxyError.timeout',
  PROXY_CONNECT_FAILED: 'connection.proxyError.connectFailed',
  PROXY_TUNNEL_FAILED: 'connection.proxyError.tunnelFailed',
  HOST_KEY_TRUST_REJECTED: 'workbench.aliases.sync.errors.hostKeyRejected',
  HOST_KEY_CHALLENGE_STALE: 'workbench.aliases.sync.errors.hostKeyExpired',
  HOST_KEY_CHALLENGE_EXPIRED: 'workbench.aliases.sync.errors.hostKeyExpired',
  HOST_KEY_TRUST_REQUIRED: 'workbench.aliases.sync.errors.hostKeyUnavailable',
  HOST_KEY_CHANGED: 'workbench.aliases.sync.errors.hostKeyUnavailable',
  HOST_KEY_QUEUE_FULL: 'workbench.aliases.sync.errors.hostKeyUnavailable',
  HOST_KEY_STORE_CORRUPT: 'workbench.aliases.sync.errors.hostKeyUnavailable',
  HOST_KEY_SERVICE_CLOSED: 'workbench.aliases.sync.errors.hostKeyUnavailable',
  HOST_KEY_INVALID_INPUT: 'workbench.aliases.sync.errors.hostKeyUnavailable',
}

export function aliasErrorDescription(code: string, message: string, t: TFunction) {
  const translationKey = aliasErrorTranslationKeys[code]
  if (translationKey) {
    return t(translationKey)
  }
  return message || t('workbench.aliases.operationFailed')
}

export function aliasSyncErrorDescription(code: string, message: string, t: TFunction) {
  const translationKey = aliasSyncErrorTranslationKeys[code]
  return translationKey ? t(translationKey) : aliasErrorDescription(code, message, t)
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
    className: termousNotificationClassName,
  })
}
