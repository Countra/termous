import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Progress, Tag, Tooltip } from 'antd'
import { KeyRound, Monitor, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudRekeyStatus, CloudSession, CloudStatus } from '#common/contracts'
import type { CloudGateway } from '#entities/cloud'
import { WorkspaceEmptyState } from '#shared/ui'
import { useCloudReconnect } from '../model/useCloudReconnect'
import { useCloudChanges } from '../model/useCloudChanges'
import { useCloudMFA } from '../model/useCloudMFA'
import { AccountLoading, AccountSection } from './AccountSection'
import { AccountMFA } from './AccountMFA'
import { AccountVerification } from './AccountVerification'
import { AccountRecovery } from './AccountRecovery'
import { AccountPersonalRecovery } from './AccountPersonalRecovery'
import { AccountStepUpDialog } from './AccountStepUpDialog'
import styles from './CloudAccount.module.scss'

interface Props { api: CloudGateway; status: CloudStatus; busy: boolean; run: <T>(action: () => Promise<T>) => Promise<T | undefined> }

export function AccountSecurity({ api, status, busy, run }: Props) {
  const { t } = useTranslation()
  const [sessions, setSessions] = useState<CloudSession[]>([])
  const [sessionsError, setSessionsError] = useState(false)
  const [rekeyError, setRekeyError] = useState(false)
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [rekeyLoading, setRekeyLoading] = useState(true)
  const [rekey, setRekey] = useState<CloudRekeyStatus>()
  const [operation, setOperation] = useState<{ kind: 'session'; id: string } | { kind: 'rekey'; action: 'start' | 'resume' | 'cancel' }>()
  const generation = status.generation
  const mfa = useCloudMFA(api, generation)
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
    setSessions([]); setRekey(undefined); setSessionsError(false); setRekeyError(false); setOperation(undefined)
    refresh()
    return () => { scope.active = false }
  }, [api, generation, refresh])
  useCloudReconnect(api, generation, refresh)
  useCloudChanges(api, generation, ['sessions'], loadSessions)
  useCloudChanges(api, generation, ['rekey'], loadRekey)
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
    <AccountPersonalRecovery key={generation} api={api} status={status} busy={busy} run={run} />
    <AccountRecovery api={api} status={status} busy={busy} run={run} />
    <AccountMFA api={api} generation={generation} value={mfa.value} loading={mfa.loading} error={mfa.error} busy={busy} accept={mfa.accept} reload={mfa.reload} onChanged={() => void loadSessions()} run={run} />
    <AccountVerification api={api} generation={generation} mfa={mfa.value} unavailable={mfa.loading || mfa.error || !mfa.value} busy={busy} accept={mfa.accept} reload={mfa.reload} run={run} />
    <AccountSection title={t('cloud.sessions')} icon={<Monitor size={18} />} description={t('cloud.sessionsHint')} extra={<Button icon={<RefreshCw size={15} />} loading={sessionsLoading} disabled={busy || sessionsLoading} onClick={() => void loadSessions()}>{t('cloud.refreshSessions')}</Button>}>
      {sessionsError ? <Alert type="warning" showIcon title={t('cloud.sessionsLoadFailed')} /> : null}
      {sessions.length ? <div className={styles.list}>{sessions.map((session) => <div className={styles.row} key={session.id}>
        <div className={styles['list-identity']}><span className={styles['list-icon']} aria-hidden="true"><Monitor size={18} /></span><div className={styles.identity}><Tooltip title={session.device_id || undefined}><strong className={styles.identifier}>{session.device_id === status.device_id && session.device_id ? t('cloud.currentDevice') : session.device_id || t('cloud.unboundSession')}</strong></Tooltip><small>{t('cloud.sessionCreated', { date: new Date(session.created_at).toLocaleString() })}</small></div></div>
        {session.revoked ? <Tag>{t('cloud.deviceStates.revoked')}</Tag>
          : session.id === status.current_session_id ? <Tag>{t('cloud.currentSession')}</Tag>
            : <Button size="small" danger disabled={busy || mfa.loading || mfa.error || !mfa.value} onClick={() => setOperation({ kind: 'session', id: session.id })}>{t('cloud.revoke')}</Button>}
      </div>)}</div> : sessionsLoading ? <AccountLoading /> : !sessionsError ? <WorkspaceEmptyState className={styles.empty} icon={<Monitor size={20} />} title={t('cloud.noSessions')} /> : null}
    </AccountSection>
    <AccountSection title={t('cloud.rekeyTitle')} icon={<KeyRound size={18} />} description={t('cloud.rekeyHint')} extra={<Button size="small" type="text" icon={<RefreshCw size={15} />} loading={rekeyLoading} disabled={busy || rekeyLoading} onClick={() => void loadRekey()}>{t('cloud.refreshRekey')}</Button>}>
      {rekeyError ? <Alert type="warning" showIcon title={t('cloud.rekeyLoadFailed')} /> : null}
      {!rekey && rekeyLoading ? <AccountLoading /> : <>
        {rekey?.status ? <div className={styles.identity} role="status"><strong>{t(`cloud.rekeyStates.${rekey.status}`)}</strong>{rekey.total > 0 ? <><small>{rekey.completed} / {rekey.total}</small><Progress percent={Math.min(100, Math.max(0, rekey.completed / rekey.total * 100))} showInfo={false} /></> : null}</div> : !rekeyError ? <p className={styles.hint}>{t('cloud.noRekey')}</p> : null}
      </>}
      <div className={styles.actions}>
        <Button disabled={busy || mfa.loading || mfa.error || !mfa.value || rekeyLoading || rekeyError || status.device_status !== 'active' || rekey?.status === 'staging'} onClick={() => setOperation({ kind: 'rekey', action: 'start' })}>{t('cloud.rekeyStart')}</Button>
        <Button disabled={busy || mfa.loading || mfa.error || !mfa.value || rekeyLoading || status.device_status !== 'active'} onClick={() => setOperation({ kind: 'rekey', action: 'resume' })}>{t('cloud.rekeyResume')}</Button>
        {rekey?.status === 'staging' ? <Button danger disabled={busy || mfa.loading || mfa.error || !mfa.value} onClick={() => setOperation({ kind: 'rekey', action: 'cancel' })}>{t('cloud.rekeyCancel')}</Button> : null}
      </div>
    </AccountSection>
    <Alert type="info" showIcon title={t('cloud.keySafety')} description={t('cloud.keySafetyHint')} />
    {operation ? <AccountStepUpDialog key={`${generation}:${operation.kind}:${operation.kind === 'session' ? operation.id : operation.action}`} api={api} generation={generation} mfa={mfa.value} unavailable={mfa.loading || mfa.error || !mfa.value} busy={busy} run={run} accept={mfa.accept} reload={mfa.reload} onUncertain={refresh} onClose={() => setOperation(undefined)}
      title={t(operation.kind === 'session' ? 'cloud.revokeSession' : operation.action === 'start' ? 'cloud.rekeyStart' : operation.action === 'cancel' ? 'cloud.rekeyCancel' : 'cloud.rekeyResume')}
      description={t(operation.kind === 'session' ? 'cloud.revokeSessionHint' : operation.action === 'cancel' ? 'cloud.rekeyCancelHint' : 'cloud.rekeyConfirm')}
      danger={operation.kind === 'session' || operation.action === 'cancel'} action={async () => {
        if (operation.kind === 'session') { await api.revokeSession(generation, operation.id); await loadSessions() }
        else await changeRekey(operation.action)
      }} /> : null}
  </div>
}
