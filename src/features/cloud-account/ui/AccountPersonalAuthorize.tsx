import { FeedbackMessage, FeedbackMessageScope } from '#shared/ui'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button, Checkbox, Modal } from 'antd'
import { KeyRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudRecoveryCredential, CloudAuthorization, CloudDevice, CloudStatus } from '#common/contracts'
import type { CloudGateway } from '#entities/cloud'
import { useCloudOperationFeedback } from '../model/useCloudOperationFeedback'
import { AccountRecoveryKeyInput } from './AccountRecoveryKeyInput'
import { AccountOperationError } from './AccountOperationError'
import styles from './AccountSafeguards.module.scss'

interface Props { api: CloudGateway; status: CloudStatus; devices: CloudDevice[]; enabled: boolean; busy: boolean; disabled: boolean; run: <T>(action: () => Promise<T>) => Promise<T | undefined>; onChanged: () => void; outstanding?: CloudAuthorization }
export function AccountPersonalAuthorize({ api, status, devices, enabled, busy, disabled, run, onChanged, outstanding }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [cancelledId, setCancelledId] = useState<string>()
  const blocked = Boolean(outstanding && outstanding.id !== cancelledId)
  const [revokes, setRevokes] = useState<string[]>([])
  const importRun = useRef(0)
  const importRequest = importRun.current
  const currentRevokes = useRef(revokes)
  useLayoutEffect(() => { currentRevokes.current = revokes }, [revokes])
  const feedback = useCloudOperationFeedback(api, status.generation, run)
  const inactive = busy || feedback.working
  useEffect(() => { importRun.current++; setOpen(false); setRevokes([]); setCancelledId(undefined) }, [api, status.generation])
  const close = () => { importRun.current++; feedback.reset(); setOpen(false); setRevokes([]) }
  const recover = async (credential: CloudRecoveryCredential | undefined, current: () => boolean) => {
    const result = await api.recoverPersonal(status.generation, credential, currentRevokes.current)
    if (!current()) return
    if (!['completed', 'acknowledged'].includes(result.status)) throw new Error('CLOUD_RESPONSE_INVALID')
    close(); onChanged(); await api.status()
  }
  return <>
    <Button icon={<KeyRound size={14} />} disabled={inactive || disabled || !enabled} onClick={() => { feedback.reset(); setOpen(true); setRevokes([]) }}>{t('cloud.safeguards.usePersonal')}</Button>
    <Modal open={open} title={t('cloud.safeguards.usePersonal')} footer={null} destroyOnHidden closable={!inactive} mask={{ closable: !inactive }} keyboard={!inactive} onCancel={close}><FeedbackMessageScope active={open}>
      <div className={styles.wizard}>
        <p>{t('cloud.safeguards.personalAuthorizeHint')} {t('cloud.safeguards.noAutoUpload')}</p>
        <AccountOperationError code={feedback.errorCode} />
        {blocked && outstanding ? <FeedbackMessage type="warning" title={t('cloud.authorization.switchHint')} /> : null}
        {devices.some(device => device.status === 'active') ? <details className={styles['key-text']}><summary>{t('cloud.safeguards.replaceDevices')}</summary><p>{t('cloud.safeguards.replaceDevicesHint')}</p><Checkbox.Group disabled={inactive || blocked} value={revokes} onChange={values => setRevokes(values as string[])} options={devices.filter(device => device.status === 'active').map(device => ({ label: device.name, value: device.id }))} /></details> : null}
        {open ? <AccountRecoveryKeyInput key={status.generation} disabled={inactive || blocked} onRecover={async credential => {
          // 弹窗退出动画可能保留子组件；旧读取不能借用再次打开后的操作上下文。
          if (importRequest !== importRun.current) return
          await feedback.perform(current => recover(credential, current))
        }} /> : null}
        <Button disabled={inactive || blocked} onClick={() => void feedback.perform(current => recover(undefined, current))}>{t('cloud.safeguards.resumeOperation')}</Button>
        <Button disabled={inactive || blocked && !outstanding?.allowed_actions.includes('cancel')} onClick={() => void feedback.perform(async current => {
          if (blocked && outstanding) {
            const result = await api.authorizationAction(status.generation, outstanding.kind, outstanding.id, 'cancel', { expected_revision: outstanding.revision })
            if (current() && result.status === 'cancelled') { setCancelledId(result.id); onChanged() }
          } else { await api.cancelPersonalRecovery(status.generation, 'recover', 'current'); if (current()) onChanged() }
        })}>{t('cloud.safeguards.cancelPrevious')}</Button>
      </div>
    </FeedbackMessageScope></Modal>
  </>
}
