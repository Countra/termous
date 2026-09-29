import { useEffect, useState } from 'react'
import { Alert, Button, Form, Input, Popconfirm, Space, Tag } from 'antd'
import { useTranslation } from 'react-i18next'
import type { CloudRekeyStatus, CloudSession, CloudStatus } from '#common/contracts'
import type { CloudGateway } from '#entities/cloud'
import styles from './CloudAccount.module.scss'

interface Props { api: CloudGateway; status: CloudStatus; busy: boolean; run: <T>(action: () => Promise<T>) => Promise<T | undefined> }

export function AccountSecurity({ api, status, busy, run }: Props) {
  const { t } = useTranslation()
  const [sessions, setSessions] = useState<CloudSession[]>([])
  const [verified, setVerified] = useState(false)
  const [error, setError] = useState(false)
  const [rekey, setRekey] = useState<CloudRekeyStatus>()
  const [form] = Form.useForm<{ password: string }>()
  useEffect(() => {
    let active = true
    void api.sessions().then((value) => { if (active) setSessions(value) }).catch(() => { if (active) setError(true) })
    void api.rekeyStatus().then((value) => { if (active) setRekey(value) }).catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [api, status.generation])

  return <div className={styles.section}>
    <section className={styles.surface}>
      <h3>{t('cloud.auth.reauthenticate')}</h3>
      <p className={styles.hint}>{t('cloud.reauthenticateHint')}</p>
      {verified ? <Alert type="success" title={t('cloud.verified')} /> : null}
      <Form form={form} layout="vertical" requiredMark={false} onFinish={(values) => void run(async () => {
        await api.auth('reauthenticate', { generation: status.generation, password: values.password })
        form.resetFields(); setVerified(true)
      })}>
        <Form.Item name="password" label={t('cloud.password')} rules={[{ required: true }]}><Input.Password autoComplete="current-password" disabled={busy} /></Form.Item>
        <Button type="primary" htmlType="submit" loading={busy}>{t('cloud.auth.reauthenticate')}</Button>
      </Form>
    </section>
    <section className={styles.surface}>
      <h3>{t('cloud.sessions')}</h3>
      {error ? <Alert type="warning" title={t('cloud.loadFailed')} /> : null}
      {sessions.map((session) => <div className={styles.row} key={session.id}>
        <div className={styles.identity}><strong>{session.device_id || t('cloud.unboundSession')}</strong><small>{new Date(session.created_at).toLocaleString()}</small></div>
        {session.revoked ? <Tag>{t('cloud.deviceStates.revoked')}</Tag>
          : session.id === status.current_session_id ? <Tag>{t('cloud.currentSession')}</Tag>
            : <Popconfirm title={t('cloud.revokeSession')} onConfirm={() => run(async () => {
              await api.revokeSession(status.generation, session.id); setSessions(await api.sessions())
            })}><Button danger disabled={busy}>{t('cloud.revoke')}</Button></Popconfirm>}
      </div>)}
    </section>
    <section className={styles.surface}>
      <h3>{t('cloud.rekeyTitle')}</h3>
      <p className={styles.hint}>{t('cloud.rekeyHint')}</p>
      {rekey?.status ? <p>{t(`cloud.rekeyStates.${rekey.status}`)}{rekey.total > 0 ? ` · ${rekey.completed} / ${rekey.total}` : ''}</p> : null}
      <Space wrap>
        <Popconfirm title={t('cloud.rekeyConfirm')} onConfirm={() => run(async () => { setRekey(await api.rekey(status.generation, 'start')) })}>
          <Button disabled={busy || status.device_status !== 'active' || rekey?.status === 'staging'}>{t('cloud.rekeyStart')}</Button>
        </Popconfirm>
        <Button disabled={busy || status.device_status !== 'active'} onClick={() => void run(async () => { setRekey(await api.rekey(status.generation, 'resume')) })}>{t('cloud.rekeyResume')}</Button>
        {rekey?.status === 'staging' ? <Popconfirm title={t('cloud.rekeyCancelHint')} onConfirm={() => run(async () => { setRekey(await api.rekey(status.generation, 'cancel')) })}><Button danger disabled={busy}>{t('cloud.rekeyCancel')}</Button></Popconfirm> : null}
      </Space>
    </section>
    <Alert type="info" showIcon title={t('cloud.keySafety')} description={t('cloud.keySafetyHint')} />
  </div>
}
