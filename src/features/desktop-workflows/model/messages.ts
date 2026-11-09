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

const analysisMessageKeys: Record<string, string> = {
  analysis_image_unavailable: 'imagePreview.failed',
  analysis_invalid_crop: 'analysisCenter.image.invalidCrop',
  analysis_invalid_image_size: 'analysisCenter.image.invalidSize',
  analysis_target_unavailable: 'desktopWorkflow.targetUnavailable',
  analysis_context_changed: 'desktopWorkflow.analysisWorkspace.contextChanged',
  analysis_copy_failed: 'desktopWorkflow.analysisWorkspace.copyFailed',
  REQUEST_TIMEOUT: 'desktopWorkflow.analysisWorkspace.requestTimeout',
  NETWORK_ERROR: 'desktopWorkflow.analysisWorkspace.connectionFailed',
}

export function analysisError(error: unknown, t: TFunction): string {
  const value = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : undefined
  const detail = typeof error === 'string' ? error : typeof value?.message === 'string' ? value.message : ''
  const code = typeof value?.code === 'string' && value.code ? value.code : detail
  // 仅展示已定义的用户文案，避免独立窗口丢失错误类型后透出底层异常原文。
  const fallback = t('analysisCenter.operationFailed')
  if (!code) return fallback
  const key = Object.prototype.hasOwnProperty.call(analysisMessageKeys, code) ? analysisMessageKeys[code] : `desktopWorkflow.errors.${code}`
  return t(key, { defaultValue: fallback })
}
export const isRunActive = (state: string) => ['preparing', 'running', 'paused'].includes(state)
