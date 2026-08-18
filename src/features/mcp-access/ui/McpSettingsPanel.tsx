import { App as AntdApp } from 'antd'
import { useTranslation } from 'react-i18next'
import { termousNotificationClassName } from '#shared/ui'
import { useMcpAccessRuntime } from '../runtime/mcpAccessContext'
import { McpClientManagement } from './clients/McpClientManagement'
import { McpServerSettings } from './settings/McpServerSettings'
import styles from './McpSettingsPanel.module.scss'

export function McpSettingsPanel() {
  const { t } = useTranslation()
  const { notification } = AntdApp.useApp()
  const runtime = useMcpAccessRuntime()
  const notifyFailure = () => notification.error({
    title: t('settings.mcp.operationFailed'),
    duration: 4,
    className: termousNotificationClassName,
  })

  return (
    <div className={styles.stack}>
      <McpServerSettings runtime={runtime} onFailure={notifyFailure} />
      <McpClientManagement runtime={runtime} onFailure={notifyFailure} />
    </div>
  )
}
