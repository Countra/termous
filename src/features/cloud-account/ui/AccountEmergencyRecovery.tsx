import { useEffect, useState, type ReactElement } from 'react'
import { Dropdown } from 'antd'
import { ShieldAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudGateway } from '#entities/cloud'
import { ConfirmDialog, FeedbackMessage, contextActionMenuPopupClassName } from '#shared/ui'
import { useCloudOperationFeedback } from '../model/useCloudOperationFeedback'
import { AccountOperationError } from './AccountOperationError'
import styles from './AccountEmergencyRecovery.module.scss'

interface Props {
  api: CloudGateway
  generation: string
  busy: boolean
  run: <T>(action: () => Promise<T>) => Promise<T | undefined>
  children: ReactElement
}

export function AccountEmergencyRecovery({ api, generation, busy, run, children }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [completed, setCompleted] = useState(false)
  const feedback = useCloudOperationFeedback(api, generation, run)
  const disabled = busy || feedback.working
  useEffect(() => { setOpen(false); setCompleted(false) }, [api, generation])

  return <>
    <Dropdown trigger={['click']} placement="bottomRight" disabled={disabled}
      classNames={{ root: contextActionMenuPopupClassName }}
      menu={{ items: [{ key: 'emergency', danger: true,
        icon: <ShieldAlert size={16} className={styles.icon} aria-hidden="true" />,
        label: <span className={styles.copy}><span className={styles.title}>{t('cloud.authorization.emergency')}</span><small>{t('cloud.authorization.emergencyIdentity')}</small></span>,
      }], onClick: () => {
        if (disabled) return
        feedback.reset(); setCompleted(false); setOpen(true)
      } }}>
      {children}
    </Dropdown>
    <AccountOperationError code={feedback.errorCode} />
    {completed ? <FeedbackMessage type="success" title={t('cloud.authorization.emergencyCompleted')} /> : null}
    <ConfirmDialog open={open} title={t('cloud.authorization.emergency')} description={t('cloud.authorization.emergencyConfirm')}
      confirmLabel={t('cloud.authorization.emergencySubmit')} danger confirmLoading={disabled}
      onCancel={() => { if (!disabled) setOpen(false) }}
      onConfirm={() => {
        if (disabled) return
        void feedback.perform(async current => {
          await api.emergencyFreeze(generation)
          // 旧账号的响应不能关闭新账号的确认框或展示成功消息。
          if (current()) { setOpen(false); setCompleted(true) }
        })
      }} />
  </>
}
