import { FeedbackMessage } from '#shared/ui'
import { useTranslation } from 'react-i18next'

export function AccountOperationError({ code }: { code?: string }) {
  const { t } = useTranslation()
  return code ? <FeedbackMessage type="error" title={t(`cloud.errors.${code}`, { defaultValue: t('cloud.operationFailed') })} description={t('cloud.safeguards.errorCode', { code })} /> : null
}
