import { Button, Switch, Tag, Tooltip } from 'antd'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LoginItemError, LoginItemState } from '#common/contracts'
import { getLoginItemGateway } from '../../api/loginItemGateway'
import surfaceStyles from '../SettingsSurface.module.scss'
import styles from './GeneralSettings.module.scss'

export function LoginItemSetting({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation()
  const gateway = getLoginItemGateway()
  const hintId = useId()
  const [snapshot, setSnapshot] = useState<LoginItemState | null>(null)
  const [error, setError] = useState<LoginItemError | null>(null)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const revision = useRef(0)

  const request = useCallback(async (enabled?: boolean) => {
    if (!gateway || pending.current) return
    const current = ++revision.current
    pending.current = true
    setBusy(true)
    try {
      const result = enabled === undefined ? await gateway.get() : await gateway.setEnabled(enabled)
      if (revision.current !== current) return
      if (result.ok) {
        setSnapshot(result.value)
        setError(null)
      } else {
        // 修改失败后状态可能不确定；先禁用开关，只允许重新读取，不自动重放写入。
        setSnapshot(null)
        setError(result.error)
      }
    } catch {
      if (revision.current !== current) return
      setSnapshot(null)
      setError(enabled === undefined ? 'read_failed' : 'write_failed')
    } finally {
      if (revision.current === current) {
        pending.current = false
        setBusy(false)
      }
    }
  }, [gateway])

  useEffect(() => {
    void request()
    const refresh = () => { void request() }
    window.addEventListener('focus', refresh)
    return () => {
      revision.current += 1
      pending.current = false
      window.removeEventListener('focus', refresh)
    }
  }, [request])

  const unavailable = !gateway ? 'desktop_only' : snapshot?.unavailable_reason
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
            role={error ? 'alert' : snapshot?.requires_approval ? 'status' : undefined}
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
          checked={snapshot?.enabled ?? false}
          disabled={disabled || busy || !snapshot?.available || !gateway}
          loading={busy}
          onChange={(enabled) => {
            if (!disabled && snapshot?.available) void request(enabled)
          }}
        />
      </div>
    </div>
  )
}
