import { App as AntdApp, Form, Input, Modal } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RemoteDesktopSession } from '#entities/remote-desktop'
import {
  type RemoteDesktopCredentials,
  useRemoteDesktopRuntime,
} from '#features/remote-desktop'
import { termousNotificationClassName } from '#shared/ui'
import styles from './RemoteDesktopWorkspace.module.scss'

export function RemoteDesktopCredentialDialog({ session, visible = true }: { session: RemoteDesktopSession; visible?: boolean }) {
  return <CredentialPrompt key={`${session.id}:${session.connection_generation}`} session={session} visible={visible} />
}

function CredentialPrompt({ session, visible }: { session: RemoteDesktopSession; visible: boolean }) {
  const { t } = useTranslation()
  const { notification } = AntdApp.useApp()
  const runtime = useRemoteDesktopRuntime()
  const state = runtime.viewerStates[session.id]
  const [values, setValues] = useState<RemoteDesktopCredentials>({})
  const [pending, setPending] = useState<'submit' | 'close' | null>(null)
  const inFlight = useRef(false)
  const open = state?.connection === 'credentials_required'
  const credentialFieldsKey = state?.credentialFields
    .map((field) => `${field.id}:${field.kind}:${field.required ? '1' : '0'}`)
    .join('|') ?? ''
  const missingRequiredValue = state?.credentialFields.some((field) => (
    field.required && !(values[field.id] ?? '').length
  )) ?? true
  const target = session.protocol === 'rdp' ? session.rdp : session.vnc
  const server = target?.target_host || session.host_name
  const endpoint = target?.port ? `${server.includes(':') ? `[${server}]` : server}:${target.port}` : server

  useEffect(() => {
    setValues({})
  }, [credentialFieldsKey, open, session.id])

  const decide = async (decision: 'submit' | 'close') => {
    if (inFlight.current || !state || (decision === 'submit' && missingRequiredValue)) return
    inFlight.current = true
    setPending(decision)
    try {
      if (decision === 'submit') {
        const credentials = Object.fromEntries(
          state.credentialFields.map((field) => [field.id, values[field.id] ?? '']),
        ) as RemoteDesktopCredentials
        await runtime.submitCredentials(session.id, credentials)
      } else {
        await runtime.closeSession(session.id)
      }
      setValues({})
    } catch (error) {
      notification.error({
        title: decision === 'close' ? t('remoteDesktop.disconnectFailed') : t('remoteDesktop.credentialsTitle', { protocol: session.protocol.toUpperCase() }),
        description: publicError(error),
        className: termousNotificationClassName,
      })
    } finally {
      inFlight.current = false
      setPending(null)
    }
  }

  return (
    <Modal
      open={open && visible}
      centered
      width={440}
      zIndex={3950}
      title={t('remoteDesktop.credentialsTitle', { protocol: session.protocol.toUpperCase() })}
      okText={t('app.connect')}
      cancelText={t('remoteDesktop.disconnect')}
      confirmLoading={pending === 'submit'}
      okButtonProps={{ disabled: missingRequiredValue || pending !== null }}
      cancelButtonProps={{ disabled: pending !== null, loading: pending === 'close' }}
      onOk={() => void decide('submit')}
      onCancel={() => void decide('close')}
      closable={false}
      keyboard={pending === null}
      mask={{ closable: false }}
      destroyOnHidden
    >
      <p><strong>{session.profile_name || session.host_name}</strong><br />{endpoint}</p>
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
              disabled={pending !== null}
              type={field.kind === 'secret' ? 'password' : 'text'}
              value={values[field.id] ?? ''}
              onChange={(event) => setValues((current) => ({
                ...current,
                [field.id]: event.target.value,
              }))}
              onPressEnter={() => void decide('submit')}
            />
          </Form.Item>
        ))}
      </Form>
    </Modal>
  )
}

function publicError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
