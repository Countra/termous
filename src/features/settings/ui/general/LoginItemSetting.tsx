import { Button, Switch, Tag, Tooltip } from 'antd'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { LoginItemError } from '#common/contracts'
import { useSettingsModule } from '#entities/settings'
import surfaceStyles from '../SettingsSurface.module.scss'
import styles from './GeneralSettings.module.scss'

export function LoginItemSetting({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation()
  const hintId = useId()
  const module = useSettingsModule('login_item', { refreshOnFocus: true })
  const { busy } = module
  const saved = module.snapshot
  const snapshot = saved ? { ...saved.value, ...saved.state } : null
  const message = module.error?.message ?? ''
  const code = message.startsWith('LOGIN_ITEM_') ? message.slice('LOGIN_ITEM_'.length).toLowerCase() : 'read_failed'
  const error: LoginItemError | null = module.error ? code as LoginItemError : null
  const request = (enabled?: boolean) => enabled === undefined ? module.refresh() : module.update({ enabled })
  const unavailable = !saved || saved.state.reason === 'desktop_only' ? 'desktop_only' : snapshot?.unavailable_reason
  const isDevelopment = unavailable === 'development'
  const hint = error
    ? t(`settings.loginItem.errors.${error}`)
    : unavailable && !isDevelopment
      ? t(`settings.loginItem.${unavailable}`)
      : snapshot?.requires_approval
        ? t('settings.loginItem.requiresApproval')
        : t('settings.loginItem.hint')
  return (
    <div className={styles['login-item-row']}>
      <div>
        <div className={styles['login-item-heading']}>
          <strong>{t('settings.loginItem.title')}</strong>
          {isDevelopment ? (
            <Tooltip title={t('settings.loginItem.development')} trigger={['hover', 'focus']}>
              <Tag className={styles['login-item-development']} tabIndex={0}>
                {t('settings.loginItem.developmentLabel')}
              </Tag>
            </Tooltip>
          ) : null}
        </div>
        <div className={styles['login-item-description']}>
          <p
            id={hintId}
            className={`${surfaceStyles.hint} ${styles['login-item-hint']} ${error ? styles['login-item-error'] : ''}`}
            role={error ? 'alert' : snapshot?.requires_approval === true ? 'status' : undefined}
          >
            {hint}
          </p>
          {error ? (
            <Button type="link" size="small" disabled={disabled || busy} onClick={() => void request()}>
              {t('app.retry')}
            </Button>
          ) : null}
        </div>
      </div>
      <div className={styles['login-item-control']}>
        <Switch
          aria-label={t('settings.loginItem.title')}
          aria-describedby={hintId}
          checked={snapshot?.enabled === true}
          disabled={disabled || busy || snapshot?.available !== true || Boolean(error)}
          loading={busy}
          onChange={(enabled) => {
            if (!disabled && snapshot?.available) void request(enabled)
          }}
        />
      </div>
    </div>
  )
}
