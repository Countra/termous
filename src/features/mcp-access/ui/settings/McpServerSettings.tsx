import { Alert, App as AntdApp, Button, Switch } from 'antd'
import { Clipboard, PlugZap, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getTermousBridge } from '#shared/bridge'
import { termousNotificationClassName } from '#shared/ui'
import type { McpAccessRuntimeValue } from '../../runtime/mcpAccessContext'
import styles from '../McpSettingsPanel.module.scss'

interface McpServerSettingsProps {
  runtime: McpAccessRuntimeValue
  onFailure: () => void
}

export function McpServerSettings({ runtime, onFailure }: McpServerSettingsProps) {
  const { t } = useTranslation()
  const { notification } = AntdApp.useApp()
  const statusBusy = runtime.mutationKey === 'server'
  const unavailable = runtime.phase === 'degraded'

  return (
    <section className={styles.surface}>
      <header className={styles.heading}>
        <span className={styles['heading-icon']} aria-hidden="true"><PlugZap size={18} /></span>
        <div>
          <h2>{t('settings.mcp.title')}</h2>
          <p>{t('settings.mcp.description')}</p>
        </div>
        <span className={`${styles['state-pill']} ${styles[`is-${runtime.status?.state ?? 'disabled'}`]}`}>
          <span />
          {t(`settings.mcp.state.${runtime.status?.state ?? 'disabled'}`)}
        </span>
      </header>

      {unavailable ? (
        <Alert
          type="warning"
          showIcon
          title={t('settings.mcp.unavailable')}
          description={runtime.errorCode}
          action={(
            <Button size="small" type="text" icon={<RefreshCw size={14} />} onClick={() => void runtime.reload()}>
              {t('app.retry')}
            </Button>
          )}
        />
      ) : null}

      <div className={styles['setting-row']}>
        <div>
          <strong>{t('settings.mcp.enable')}</strong>
          <p>{t('settings.mcp.enableHint')}</p>
        </div>
        <Switch
          checked={runtime.status?.enabled ?? false}
          loading={runtime.phase === 'loading' || statusBusy}
          disabled={!runtime.status || unavailable || Boolean(runtime.mutationKey)}
          aria-label={t('settings.mcp.enable')}
          onChange={(checked) => void runtime.setEnabled(checked).catch(onFailure)}
        />
      </div>

      <div className={styles['endpoint-row']}>
        <div>
          <small>{t('settings.mcp.endpoint')}</small>
          <code>{runtime.status?.endpoint || '—'}</code>
        </div>
        <Button
          icon={<Clipboard size={15} />}
          disabled={!runtime.status?.endpoint}
          onClick={() => void copyText(runtime.status?.endpoint ?? '')
            .then(() => notification.success({
              title: t('settings.mcp.copied'),
              duration: 2,
              className: termousNotificationClassName,
            }))
            .catch(onFailure)}
        >
          {t('app.copy')}
        </Button>
      </div>
      <p className={styles['endpoint-hint']}>{t('settings.mcp.endpointHint')}</p>
      <p className={styles.protocol}>MCP {runtime.status?.protocol_version ?? '2025-11-25'}</p>
    </section>
  )
}

async function copyText(value: string) {
  const bridge = getTermousBridge()
  if (bridge?.clipboard) {
    await bridge.clipboard.writeText(value)
    return
  }
  await navigator.clipboard.writeText(value)
}
