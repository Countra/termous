import { App as AntdApp, Button, Checkbox, Modal } from 'antd'
import { Check, Copy, Fingerprint } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RemoteDesktopSession } from '#entities/remote-desktop'
import { useRemoteDesktopRuntime } from '#features/remote-desktop'
import { writeClipboardText } from '#shared/clipboard'
import { termousNotificationClassName } from '#shared/ui'
import styles from './RemoteDesktopServerVerificationDialog.module.scss'

export function RemoteDesktopServerVerificationDialog({ session, visible = true }: { session: RemoteDesktopSession; visible?: boolean }) {
  const runtime = useRemoteDesktopRuntime()
  const state = runtime.viewerStates[session.id]
  if (state?.connection !== 'verifying_server' || !state.verification) return null
  if (session.protocol === 'rdp' && session.status !== 'waiting_host_trust') return null
  return (
    <ServerVerificationPrompt
      key={`${session.id}:${session.connection_generation}:${session.certificate?.challenge_id ?? state.verification.fingerprint}`}
      session={session}
      visible={visible}
      verification={state.verification}
      onApprove={(remember) => runtime.approveServer(session.id, remember)}
      onReject={() => runtime.rejectServer(session.id)}
    />
  )
}

function ServerVerificationPrompt({ session, visible, verification, onApprove, onReject }: {
  session: RemoteDesktopSession
  visible: boolean
  verification: { type: string; fingerprint: string }
  onApprove: (remember: boolean) => void | Promise<void>
  onReject: () => Promise<void>
}) {
  const { t } = useTranslation()
  const { notification } = AntdApp.useApp()
  const [remember, setRemember] = useState(false)
  const [copied, setCopied] = useState(false)
  const [pending, setPending] = useState<'approve' | 'reject' | null>(null)
  const inFlight = useRef(false)
  const title = t('remoteDesktop.verifyServerTitle', { protocol: session.protocol.toUpperCase() })
  const target = session.protocol === 'rdp' ? session.rdp : session.vnc
  const server = target?.target_host || session.certificate?.server_name || session.host_name
  const endpoint = target?.port ? `${server.includes(':') ? `[${server}]` : server}:${target.port}` : server

  const decide = async (decision: 'approve' | 'reject') => {
    if (inFlight.current) return
    inFlight.current = true
    setPending(decision)
    try {
      if (decision === 'approve') await onApprove(remember)
      else await onReject()
    } catch (error) {
      notification.error({
        title: decision === 'reject' ? t('remoteDesktop.disconnectFailed') : title,
        description: error instanceof Error ? error.message : String(error),
        className: termousNotificationClassName,
      })
    } finally {
      inFlight.current = false
      setPending(null)
    }
  }

  const copyFingerprint = async () => {
    try {
      await writeClipboardText(verification.fingerprint)
      setCopied(true)
    } catch (error) {
      notification.error({
        title: t('remoteDesktop.copyFingerprintFailed'),
        description: error instanceof Error ? error.message : String(error),
        className: termousNotificationClassName,
      })
    }
  }

  return (
    <Modal
      open={visible}
      centered
      width={560}
      zIndex={3950}
      title={<span className={styles.title}><Fingerprint size={20} aria-hidden="true" />{title}</span>}
      okText={t('remoteDesktop.trustAndContinue')}
      cancelText={t('remoteDesktop.rejectServer')}
      confirmLoading={pending === 'approve'}
      okButtonProps={{ disabled: pending !== null }}
      cancelButtonProps={{ disabled: pending !== null, loading: pending === 'reject' }}
      onOk={() => void decide('approve')}
      onCancel={() => void decide('reject')}
      keyboard={pending === null}
      closable={false}
      mask={{ closable: false }}
    >
      <div className={styles.content}>
        <p className={styles.hint}>{t('remoteDesktop.verifyServerHint')}</p>
        <dl className={styles.details}>
          <div><dt>{t('remoteDesktop.serverAddress')}</dt><dd>{endpoint}</dd></div>
          {session.certificate?.server_name && session.certificate.server_name !== server ? <div><dt>{t('remoteDesktop.certificateServerName')}</dt><dd>{session.certificate.server_name}</dd></div> : null}
          {session.certificate ? <div><dt>{t('remoteDesktop.certificateSubject')}</dt><dd>{session.certificate.subject}</dd></div> : null}
          <div><dt>{t('remoteDesktop.verificationType')}</dt><dd>{verification.type}</dd></div>
        </dl>
        <div className={styles.fingerprint}>
          <div className={styles['fingerprint-heading']}>
            <span>{t('hostKey.fingerprint')}</span>
            <Button
              type="text"
              size="small"
              icon={copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
              onClick={() => void copyFingerprint()}
              aria-label={t('hostKey.copyFingerprint')}
            >
              {copied ? t('remoteDesktop.fingerprintCopied') : t('hostKey.copyFingerprint')}
            </Button>
          </div>
          <code className={styles['fingerprint-value']}>{verification.fingerprint}</code>
        </div>
        {session.protocol === 'rdp' ? (
          <div className={styles.remember}>
            <Checkbox checked={remember} disabled={pending !== null} onChange={(event) => setRemember(event.target.checked)}>
              {t('remoteDesktop.rdp.rememberCertificate')}
            </Checkbox>
            <p>{t('remoteDesktop.rdp.rememberCertificateHint')}</p>
          </div>
        ) : <p className={styles.hint}>{t('remoteDesktop.sessionTrustHint')}</p>}
      </div>
    </Modal>
  )
}
