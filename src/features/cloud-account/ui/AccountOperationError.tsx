import { Alert } from 'antd'
import { useTranslation } from 'react-i18next'

export function AccountOperationError({ code }: { code?: string }) {
  const { t } = useTranslation()
  return code ? <Alert type="error" showIcon title={t(`cloud.errors.${code}`, { defaultValue: t('cloud.operationFailed') })} description={t('cloud.safeguards.errorCode', { code })} /> : null
}
