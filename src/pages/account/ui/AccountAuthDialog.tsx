import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Modal, Skeleton } from 'antd'
import { ArrowRight, ChevronDown, CloudOff, Monitor, ShieldCheck, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudGateway } from '#entities/cloud'
import { AccountAuth, AccountEmergencyRecovery, useCloudAccount } from '#features/cloud-account'
import { FeedbackMessageScope, WorkspaceEmptyState } from '#shared/ui'
import { AccountAuthStory } from './AccountAuthStory'
import styles from './AccountAuthDialog.module.scss'

interface Props {
  api: CloudGateway
  onClose: () => void
  onAuthenticated?: () => void
  reauthenticate?: boolean
  guided?: boolean
  onBusyChange?: (busy: boolean) => void
}

export function AccountAuthDialog({ api, onClose, onAuthenticated, reauthenticate = false, guided = false, onBusyChange }: Props) {
  const { t } = useTranslation()
  const { status, busy, error, run, refresh, clearError } = useCloudAccount(api)
  const contentRef = useRef<HTMLDivElement>(null)
  const resetContentScroll = useCallback(() => { if (contentRef.current) contentRef.current.scrollTop = 0 }, [])
  const [authFeedback, setAuthFeedback] = useState(true)
  // 本机初始化故障通过成功返回的状态报告，不能仅依赖请求异常。
  const unavailableError = status?.phase === 'unavailable' ? status.error_code : undefined
  const authenticationError = authFeedback ? error ?? unavailableError : undefined
  const runAuthentication: typeof run = action => { setAuthFeedback(true); return run(action) }
  const runEmergency: typeof run = action => { setAuthFeedback(false); return run(action) }
  const emergencyAvailable = status?.device_status === 'active' && Boolean(status.binding_id)
    && (!status.authenticated || status.error_code === 'login_required' || status.error_code === 'refresh_unconfirmed')
  useEffect(() => {
    // 密码和扫码都以 Core 的最终认证状态为准，不把二步验证挑战视为登录成功。
    if (status?.authenticated && status.error_code !== 'login_required' && status.error_code !== 'refresh_unconfirmed') (onAuthenticated ?? onClose)()
  }, [status, onAuthenticated, onClose])
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false) }, [busy, onBusyChange])

  return <Modal open centered width={1080} title={<span className={styles['accessible-title']}>{t('nav.account')}</span>}
    footer={null} transitionName="" destroyOnHidden mask={{ closable: false }} keyboard={!busy && !guided}
    zIndex={guided ? 2970 : undefined} focusable={{ trap: !guided }}
    closable={{ disabled: busy || guided, 'aria-label': t('app.close') }} closeIcon={<X size={18} aria-hidden="true" />}
    className={styles.dialog} rootClassName={`termous-modal-root ${styles.root}${guided ? ' termous-product-tour-surface' : ''}`}
    classNames={{ container: styles.container, header: styles.header, body: styles.body, close: styles.close }}
    onCancel={() => { if (!busy && !guided) onClose() }}>
    <AccountAuthStory />
    <div className={styles.access}>
      <FeedbackMessageScope scope={status?.generation ?? 'account-auth'}>
        <div ref={contentRef} className={styles.content} data-tour="account-workspace">
          {status?.configured ? <AccountAuth key={status.generation} api={api} generation={status.generation}
            email={reauthenticate ? status.email : undefined} reauthenticate={reauthenticate}
            busy={busy} run={runAuthentication} error={authenticationError} onClearError={clearError} onViewChange={resetContentScroll} />
            : status ? <div className={styles.fallback}>
              {authenticationError ? <Alert showIcon type="error" title={t(`cloud.errors.${authenticationError}`, { defaultValue: t('cloud.operationFailed') })} /> : null}
              <WorkspaceEmptyState icon={<CloudOff size={24} />} title={t('cloud.unconfiguredTitle')} description={t('cloud.unconfigured')} />
            </div>
              : error ? <div className={styles.fallback}><Alert showIcon type="error" title={t('cloud.loadFailed')} /><Button block onClick={() => void refresh()}>{t('cloud.retry')}</Button></div>
                : <div role="status" aria-label={t('cloud.loading')}><Skeleton active paragraph={{ rows: 4 }} /></div>}
        </div>
        <footer className={styles.footer}>
          <Button type="text" icon={<Monitor size={15} aria-hidden="true" />} disabled={busy || guided} onClick={onClose}>
            {t(reauthenticate ? 'app.cancel' : 'cloud.login.continueLocal')}<ArrowRight size={14} aria-hidden="true" />
          </Button>
          {emergencyAvailable && status ? <AccountEmergencyRecovery key={status.generation} api={api} generation={status.generation} busy={busy} run={runEmergency}>
            <Button type="text" size="small" icon={<ShieldCheck size={14} aria-hidden="true" />} disabled={busy} aria-haspopup="menu">{t('cloud.authorization.securityOptions')}<ChevronDown size={12} aria-hidden="true" /></Button>
          </AccountEmergencyRecovery> : null}
        </footer>
      </FeedbackMessageScope>
    </div>
  </Modal>
}
