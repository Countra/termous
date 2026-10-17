import type { TFunction } from 'i18next'
import { TermousApiError } from '#shared/api'

export function wasRequestRejected(error: unknown): boolean {
  return error instanceof TermousApiError && error.status >= 400 && error.status < 500 && error.status !== 408
}

export function workflowError(error: unknown, t: TFunction): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  if (code && t(`desktopWorkflow.errors.${code}`, { defaultValue: '' })) return t(`desktopWorkflow.errors.${code}`)
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : t('desktopWorkflow.requestFailed')
}
export const isRunActive = (state: string) => ['preparing', 'running', 'paused'].includes(state)
