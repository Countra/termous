import { useEffect, useMemo, useRef, useState } from 'react'
import { App as AntdApp, Button, Modal } from 'antd'
import { ServerCog, ShieldCheck, ShieldX } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { termousNotificationClassName } from '#shared/ui'
import { useMcpAccessRuntime } from '../runtime/mcpAccessContext'
import { McpApprovalDetails } from './approval/McpApprovalDetails'
import { McpApprovalExpiry } from './approval/McpApprovalExpiry'
import styles from './McpApprovalCoordinator.module.scss'

interface McpApprovalCoordinatorProps {
  blocked?: boolean
}

export function McpApprovalCoordinator({ blocked = false }: McpApprovalCoordinatorProps) {
  const { t } = useTranslation()
  const { notification } = AntdApp.useApp()
  const { approvals, mutationKey, decideApproval, reload } = useMcpAccessRuntime()
  const approval = blocked ? null : approvals[0] ?? null
  const approvalId = approval?.id ?? ''
  const mutationBusy = Boolean(mutationKey)
  const approvalBusy = approval ? mutationKey === `approval:${approval.id}` : false
  const [now, setNow] = useState(() => Date.now())
  const expiryTimestamp = useMemo(
    () => approval?.expires_at ? Date.parse(approval.expires_at) : Number.NaN,
    [approval?.expires_at],
  )
  const remainingSeconds = Number.isFinite(expiryTimestamp)
    ? Math.max(0, Math.ceil((expiryTimestamp - now) / 1_000))
    : 0
  const expired = Boolean(approval) && remainingSeconds === 0
  const expiryReconciledRef = useRef('')

  useEffect(() => {
    if (!approvalId) return undefined
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [approvalId])

  useEffect(() => {
    if (!approval || !expired || expiryReconciledRef.current === approval.id) return
    expiryReconciledRef.current = approval.id
    void reload().catch(() => undefined)
  }, [approval, expired, reload])

  const decide = (decision: 'approve' | 'reject') => {
    if (!approval || expired) return
    void decideApproval(approval.id, decision).catch(() => notification.error({
      title: t('settings.mcp.operationFailed'),
      duration: 4,
      className: termousNotificationClassName,
    }))
  }

  return (
    <Modal
      open={Boolean(approval)}
      centered
      width={620}
      zIndex={3900}
      title={null}
      footer={null}
      closable={false}
      keyboard={false}
      mask={{ closable: false }}
      destroyOnHidden
      rootClassName={styles['approval-modal-root']}
      className={styles['approval-modal']}
      aria-labelledby="mcp-approval-title"
    >
      {approval ? (
        <section className={styles.dialog}>
          <header className={styles.header}>
            <span className={styles.icon} aria-hidden="true">
              <ShieldCheck size={23} />
            </span>
            <div>
              <h2 id="mcp-approval-title">{t('settings.mcp.approval.title')}</h2>
              <p>{t('settings.mcp.approval.description')}</p>
            </div>
          </header>

          <div className={styles.client}>
            <ServerCog size={17} aria-hidden="true" />
            <span>{t('settings.mcp.approval.client')}</span>
            <strong>{approval.client_name || approval.client_id || t('settings.mcp.unknownClient')}</strong>
          </div>

          <McpApprovalDetails approval={approval} />

          <footer className={styles.footer}>
            <McpApprovalExpiry expired={expired} remainingSeconds={remainingSeconds} />
            <div className={styles.actions}>
              <Button
                danger
                icon={<ShieldX size={16} aria-hidden="true" />}
                disabled={mutationBusy || expired}
                onClick={() => decide('reject')}
              >
                {t('settings.mcp.approval.reject')}
              </Button>
              <Button
                type="primary"
                icon={<ShieldCheck size={16} aria-hidden="true" />}
                loading={approvalBusy}
                disabled={mutationBusy || expired}
                onClick={() => decide('approve')}
              >
                {t('settings.mcp.approval.allowOnce')}
              </Button>
            </div>
          </footer>
        </section>
      ) : null}
    </Modal>
  )
}
