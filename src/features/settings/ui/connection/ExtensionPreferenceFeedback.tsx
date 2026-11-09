import { Button, Space } from 'antd'
import { useTranslation } from 'react-i18next'
import { FeedbackMessage } from '#shared/ui'

export function ExtensionPreferenceFeedback({ error, retry, reset }: { error?: string; retry(): void; reset?(): void }) {
  const { t } = useTranslation()
  return error ? <FeedbackMessage type="error" title={error} action={<Space size={6} wrap>
    <Button size="small" onClick={retry}>{t('extensions.preferences.retry')}</Button>{reset && <Button size="small" type="text" onClick={reset}>{t('extensions.preferences.reset')}</Button>}
  </Space>} /> : null
}
