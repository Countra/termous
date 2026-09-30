import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Form, Input, Popconfirm, Progress, Tag, Tooltip } from 'antd'
import { Fingerprint, KeyRound, Monitor, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudRekeyStatus, CloudSession, CloudStatus } from '#common/contracts'
import type { CloudGateway } from '#entities/cloud'
import { WorkspaceEmptyState } from '#shared/ui'
import { useCloudReconnect } from '../model/useCloudReconnect'
import { AccountLoading, AccountSection } from './AccountSection'
import styles from './CloudAccount.module.scss'

interface Props { api: CloudGateway; status: CloudStatus; busy: boolean; run: <T>(action: () => Promise<T>) => Promise<T | undefined> }

export function AccountSecurity({ api, status, busy, run }: Props) {
  const { t } = useTranslation()
  const [sessions, setSessions] = useState<CloudSession[]>([])
  const [verified, setVerified] = useState(false)
  const [sessionsError, setSessionsError] = useState(false)
  const [rekeyError, setRekeyError] = useState(false)
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [rekeyLoading, setRekeyLoading] = useState(true)
  const [rekey, setRekey] = useState<CloudRekeyStatus>()
  const [form] = Form.useForm<{ password: string }>()
  const generation = status.generation
  const lifetime = useRef<{ api: CloudGateway; generation: string; active: boolean; sessionsRequest: number; rekeyRequest: number } | null>(null)
  const loadSessions = useCallback(async () => {
    const scope = lifetime.current
    if (!scope?.active || scope.api !== api || scope.generation !== generation) return
    const request = ++scope.sessionsRequest
    setSessionsLoading(true)
    try {
      const value = await api.sessions()
      if (scope.active && request === scope.sessionsRequest) { setSessions(value); setSessionsError(false) }
    } catch {
      if (scope.active && request === scope.sessionsRequest) setSessionsError(true)
    } finally {
      if (scope.active && request === scope.sessionsRequest) setSessionsLoading(false)
    }
  }, [api, generation])
  const loadRekey = useCallback(async () => {
    const scope = lifetime.current
    if (!scope?.active || scope.api !== api || scope.generation !== generation) return
    const request = ++scope.rekeyRequest
    setRekeyLoading(true)
    try {
      const value = await api.rekeyStatus()
      if (scope.active && request === scope.rekeyRequest) { setRekey(value); setRekeyError(false) }
    } catch {
      if (scope.active && request === scope.rekeyRequest) setRekeyError(true)
    } finally {
      if (scope.active && request === scope.rekeyRequest) setRekeyLoading(false)
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
      setRekey(value); setRekeyError(false); setRekeyLoading(false)
    }
  }

  return <div className={styles.section}>
    <AccountSection title={t('cloud.securityVerification')} icon={<Fingerprint size={18} />} description={t('cloud.reauthenticateHint')}>
      {verified ? <Alert type="success" title={t('cloud.verified')} /> : null}
      <Form name="cloud-security" className={styles['compact-form']} form={form} layout="vertical" requiredMark={false} onFinish={(values) => void run(async () => {
        await api.auth('reauthenticate', { generation: status.generation, password: values.password })
        form.resetFields(); setVerified(true)
      })}>
        <label htmlFor="cloud-security-password">{t('cloud.password')}</label>
        <div className={styles['verification-controls']}>
          <Form.Item name="password" rules={[{ required: true, message: t('cloud.passwordRequired') }]}><Input.Password id="cloud-security-password" autoComplete="current-password" disabled={busy} /></Form.Item>
          <Button type="primary" htmlType="submit" loading={busy}>{t('cloud.auth.reauthenticate')}</Button>
        </div>
      </Form>
    </AccountSection>
    <AccountSection title={t('cloud.sessions')} icon={<Monitor size={18} />} description={t('cloud.sessionsHint')} extra={<Button icon={<RefreshCw size={15} />} loading={sessionsLoading} disabled={busy || sessionsLoading} onClick={() => void loadSessions()}>{t('cloud.refreshSessions')}</Button>}>
      {sessionsError ? <Alert type="warning" showIcon title={t('cloud.sessionsLoadFailed')} /> : null}
      {sessions.length ? <div className={styles.list}>{sessions.map((session) => <div className={styles.row} key={session.id}>
        <div className={styles['list-identity']}><span className={styles['list-icon']} aria-hidden="true"><Monitor size={18} /></span><div className={styles.identity}><Tooltip title={session.device_id || undefined}><strong className={styles.identifier}>{session.device_id === status.device_id && session.device_id ? t('cloud.currentDevice') : session.device_id || t('cloud.unboundSession')}</strong></Tooltip><small>{t('cloud.sessionCreated', { date: new Date(session.created_at).toLocaleString() })}</small></div></div>
        {session.revoked ? <Tag>{t('cloud.deviceStates.revoked')}</Tag>
          : session.id === status.current_session_id ? <Tag>{t('cloud.currentSession')}</Tag>
            : <Popconfirm title={t('cloud.revokeSession')} onConfirm={() => run(async () => {
              await api.revokeSession(status.generation, session.id); await loadSessions()
            })}><Button size="small" danger disabled={busy}>{t('cloud.revoke')}</Button></Popconfirm>}
      </div>)}</div> : sessionsLoading ? <AccountLoading /> : !sessionsError ? <WorkspaceEmptyState className={styles.empty} icon={<Monitor size={20} />} title={t('cloud.noSessions')} /> : null}
    </AccountSection>
    <AccountSection title={t('cloud.rekeyTitle')} icon={<KeyRound size={18} />} description={t('cloud.rekeyHint')} extra={<Button size="small" type="text" icon={<RefreshCw size={15} />} loading={rekeyLoading} disabled={busy || rekeyLoading} onClick={() => void loadRekey()}>{t('cloud.refreshRekey')}</Button>}>
      {rekeyError ? <Alert type="warning" showIcon title={t('cloud.rekeyLoadFailed')} /> : null}
      {!rekey && rekeyLoading ? <AccountLoading /> : <>
        {rekey?.status ? <div className={styles.identity} role="status"><strong>{t(`cloud.rekeyStates.${rekey.status}`)}</strong>{rekey.total > 0 ? <><small>{rekey.completed} / {rekey.total}</small><Progress percent={Math.min(100, Math.max(0, rekey.completed / rekey.total * 100))} showInfo={false} /></> : null}</div> : !rekeyError ? <p className={styles.hint}>{t('cloud.noRekey')}</p> : null}
      </>}
      <div className={styles.actions}>
        <Popconfirm title={t('cloud.rekeyConfirm')} onConfirm={() => run(() => changeRekey('start'))}>
          <Button disabled={busy || rekeyLoading || rekeyError || status.device_status !== 'active' || rekey?.status === 'staging'}>{t('cloud.rekeyStart')}</Button>
        </Popconfirm>
        <Button disabled={busy || rekeyLoading || status.device_status !== 'active'} onClick={() => void run(() => changeRekey('resume'))}>{t('cloud.rekeyResume')}</Button>
        {rekey?.status === 'staging' ? <Popconfirm title={t('cloud.rekeyCancelHint')} onConfirm={() => run(() => changeRekey('cancel'))}><Button danger disabled={busy}>{t('cloud.rekeyCancel')}</Button></Popconfirm> : null}
      </div>
    </AccountSection>
    <Alert type="info" showIcon title={t('cloud.keySafety')} description={t('cloud.keySafetyHint')} />
  </div>
}
