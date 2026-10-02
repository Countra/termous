import type { CloudMFAProof } from '#common/contracts'

export function buildCloudStepUpProof(enabled: boolean | undefined, values: CloudMFAProof, totpOnly = false): CloudMFAProof {
  if (enabled === undefined || totpOnly && !enabled) throw new Error('CLOUD_MFA_UNAVAILABLE')
  if (totpOnly && values.method === 'backup_code') throw new Error('mfa_invalid_code')
  // 明确选择一种证明，避免表单保留的隐藏字段混入敏感请求。
  return enabled ? { method: totpOnly || values.method !== 'backup_code' ? 'totp' : 'backup_code', code: values.code } : { password: values.password }
}
