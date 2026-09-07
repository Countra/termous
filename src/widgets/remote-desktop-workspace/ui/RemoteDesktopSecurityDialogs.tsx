import { App as AntdApp, Form, Input, Modal } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RemoteDesktopSession } from '#entities/remote-desktop'
import {
  type RemoteDesktopCredentials,
  useRemoteDesktopRuntime,
} from '#features/remote-desktop'
import { termousNotificationClassName } from '#shared/ui'
import styles from './RemoteDesktopWorkspace.module.scss'

export function RemoteDesktopCredentialDialog({ session }: { session: RemoteDesktopSession }) {
  const { t } = useTranslation()
  const { notification } = AntdApp.useApp()
  const runtime = useRemoteDesktopRuntime()
  const state = runtime.viewerStates[session.id]
  const [values, setValues] = useState<RemoteDesktopCredentials>({})
  const open = state?.connection === 'credentials_required'
  const credentialFieldsKey = state?.credentialFields
    .map((field) => `${field.id}:${field.kind}:${field.required ? '1' : '0'}`)
    .join('|') ?? ''
  const missingRequiredValue = state?.credentialFields.some((field) => (
    field.required && !(values[field.id] ?? '').length
  )) ?? true

  useEffect(() => {
    setValues({})
  }, [credentialFieldsKey, open, session.id])

  const submit = () => {
    if (!state || missingRequiredValue) {
      return
    }
    const credentials = Object.fromEntries(
      state.credentialFields.map((field) => [field.id, values[field.id] ?? '']),
    ) as RemoteDesktopCredentials
    runtime.submitCredentials(session.id, credentials)
    setValues({})
  }

  return (
    <Modal
      open={open}
      centered
      width={440}
      title={t('remoteDesktop.credentialsTitle')}
      okText={t('app.connect')}
      cancelText={t('remoteDesktop.disconnect')}
      okButtonProps={{ disabled: missingRequiredValue }}
      onOk={submit}
      onCancel={() => {
        void runtime.closeSession(session.id).catch((error) => {
          notification.error({
            title: t('remoteDesktop.disconnectFailed'),
            description: publicError(error),
            className: termousNotificationClassName,
          })
        })
      }}
      afterClose={() => setValues({})}
      destroyOnHidden
    >
      <p className={styles['dialog-hint']}>{t('remoteDesktop.credentialsHint')}</p>
      <Form layout="vertical">
        {state?.credentialFields.map((field) => (
          <Form.Item
            key={field.id}
            label={t(`remoteDesktop.credentials.${field.id}`, { defaultValue: field.id })}
            required={field.required}
          >
            <Input
              autoComplete="off"
              type={field.kind === 'secret' ? 'password' : 'text'}
              value={values[field.id] ?? ''}
              onChange={(event) => setValues((current) => ({
                ...current,
                [field.id]: event.target.value,
              }))}
              onPressEnter={() => {
                if (!missingRequiredValue) submit()
              }}
            />
          </Form.Item>
        ))}
      </Form>
    </Modal>
  )
}

export function RemoteDesktopServerVerificationDialog({
  session,
}: {
  session: RemoteDesktopSession
}) {
  const { t } = useTranslation()
  const { notification } = AntdApp.useApp()
  const runtime = useRemoteDesktopRuntime()
  const verification = runtime.viewerStates[session.id]?.verification
  return (
    <Modal
      open={Boolean(verification)}
      centered
      width={520}
      title={t('remoteDesktop.verifyServerTitle')}
      okText={t('remoteDesktop.trustAndContinue')}
      cancelText={t('remoteDesktop.rejectServer')}
      okButtonProps={{ danger: false }}
      cancelButtonProps={{ danger: true }}
      onOk={() => runtime.approveServer(session.id)}
      onCancel={() => {
        void runtime.rejectServer(session.id).catch((error) => {
          notification.error({
            title: t('remoteDesktop.disconnectFailed'),
            description: publicError(error),
            className: termousNotificationClassName,
          })
        })
      }}
      closable={false}
      mask={{ closable: false }}
    >
      <p className={styles['dialog-hint']}>{t('remoteDesktop.verifyServerHint')}</p>
      <dl className={styles.fingerprint}>
        <div><dt>{t('remoteDesktop.verificationType')}</dt><dd>{verification?.type}</dd></div>
        <div><dt>{t('hostKey.fingerprint')}</dt><dd>{verification?.fingerprint}</dd></div>
      </dl>
    </Modal>
  )
}

function publicError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
