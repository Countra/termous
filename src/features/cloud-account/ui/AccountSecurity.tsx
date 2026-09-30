import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Form, Input, Popconfirm, Space, Tag } from 'antd'
import { useTranslation } from 'react-i18next'
import type { CloudRekeyStatus, CloudSession, CloudStatus } from '#common/contracts'
import type { CloudGateway } from '#entities/cloud'
import { useCloudReconnect } from '../model/useCloudReconnect'
import styles from './CloudAccount.module.scss'

interface Props { api: CloudGateway; status: CloudStatus; busy: boolean; run: <T>(action: () => Promise<T>) => Promise<T | undefined> }

export function AccountSecurity({ api, status, busy, run }: Props) {
  const { t } = useTranslation()
  const [sessions, setSessions] = useState<CloudSession[]>([])
  const [verified, setVerified] = useState(false)
  const [sessionsError, setSessionsError] = useState(false)
  const [rekeyError, setRekeyError] = useState(false)
  const [rekey, setRekey] = useState<CloudRekeyStatus>()
  const [form] = Form.useForm<{ password: string }>()
  const generation = status.generation
  const lifetime = useRef<{ api: CloudGateway; generation: string; active: boolean; sessionsRequest: number; rekeyRequest: number } | null>(null)
  const loadSessions = useCallback(async () => {
    const scope = lifetime.current
    if (!scope?.active || scope.api !== api || scope.generation !== generation) return
    const request = ++scope.sessionsRequest
    try {
      const value = await api.sessions()
      if (scope.active && request === scope.sessionsRequest) { setSessions(value); setSessionsError(false) }
    } catch {
      if (scope.active && request === scope.sessionsRequest) setSessionsError(true)
    }
  }, [api, generation])
  const loadRekey = useCallback(async () => {
    const scope = lifetime.current
    if (!scope?.active || scope.api !== api || scope.generation !== generation) return
    const request = ++scope.rekeyRequest
    try {
      const value = await api.rekeyStatus()
      if (scope.active && request === scope.rekeyRequest) { setRekey(value); setRekeyError(false) }
    } catch {
      if (scope.active && request === scope.rekeyRequest) setRekeyError(true)
    }
  }, [api, generation])
  const refresh = useCallback(() => { void loadSessions(); void loadRekey() }, [loadSessions, loadRekey])
  useEffect(() => {
    const scope = { api, generation, active: true, sessionsRequest: 0, rekeyRequest: 0 }
    lifetime.current = scope
    setSessions([]); setRekey(undefined); setSessionsError(false); setRekeyError(false)
    refresh()
    return () => { scope.active = false }
  }, [api, generation, refresh])
  useCloudReconnect(api, generation, refresh)
  const changeRekey = async (action: 'start' | 'resume' | 'cancel') => {
    const scope = lifetime.current
    const value = await api.rekey(generation, action)
    if (scope?.active && scope.api === api && scope.generation === generation) {
      // 作业操作返回的状态比操作前发出的后台读取更新。
      scope.rekeyRequest++
      setRekey(value); setRekeyError(false)
    }
  }

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
      {sessionsError ? <Alert type="warning" title={t('cloud.loadFailed')} /> : null}
      {sessions.map((session) => <div className={styles.row} key={session.id}>
        <div className={styles.identity}><strong>{session.device_id || t('cloud.unboundSession')}</strong><small>{new Date(session.created_at).toLocaleString()}</small></div>
        {session.revoked ? <Tag>{t('cloud.deviceStates.revoked')}</Tag>
          : session.id === status.current_session_id ? <Tag>{t('cloud.currentSession')}</Tag>
            : <Popconfirm title={t('cloud.revokeSession')} onConfirm={() => run(async () => {
              await api.revokeSession(status.generation, session.id); await loadSessions()
            })}><Button danger disabled={busy}>{t('cloud.revoke')}</Button></Popconfirm>}
      </div>)}
    </section>
    <section className={styles.surface}>
      <h3>{t('cloud.rekeyTitle')}</h3>
      {rekeyError ? <Alert type="warning" title={t('cloud.loadFailed')} /> : null}
      <p className={styles.hint}>{t('cloud.rekeyHint')}</p>
      {rekey?.status ? <p>{t(`cloud.rekeyStates.${rekey.status}`)}{rekey.total > 0 ? ` · ${rekey.completed} / ${rekey.total}` : ''}</p> : null}
      <Space wrap>
        <Popconfirm title={t('cloud.rekeyConfirm')} onConfirm={() => run(() => changeRekey('start'))}>
          <Button disabled={busy || status.device_status !== 'active' || rekey?.status === 'staging'}>{t('cloud.rekeyStart')}</Button>
        </Popconfirm>
        <Button disabled={busy || status.device_status !== 'active'} onClick={() => void run(() => changeRekey('resume'))}>{t('cloud.rekeyResume')}</Button>
        {rekey?.status === 'staging' ? <Popconfirm title={t('cloud.rekeyCancelHint')} onConfirm={() => run(() => changeRekey('cancel'))}><Button danger disabled={busy}>{t('cloud.rekeyCancel')}</Button></Popconfirm> : null}
      </Space>
    </section>
    <Alert type="info" showIcon title={t('cloud.keySafety')} description={t('cloud.keySafetyHint')} />
  </div>
}
