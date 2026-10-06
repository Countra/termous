import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Spin } from 'antd'
import { useTranslation } from 'react-i18next'
import type { RemoteClient } from '#entities/remote-control'
import type { RemoteBootstrap, RemoteAgentQuote } from '#common/contracts'
import type { AgentLaunchIntent } from '#entities/agent'
import { AgentPage } from '#pages/agent'
import { RemoteFeedback, RemoteFeedbackStack, remoteCopy, remoteErrorText } from '#features/remote-control'
import { createRemoteAgentGateway } from '../api/agentGateway.ts'
import { RemoteAgentApprovals } from './RemoteAgentApprovals.tsx'
import { emptyAgentResources, loadAgentResources } from '../api/agentResources.ts'
import styles from './RemoteAgentSurface.module.scss'

export function RemoteAgentSurface({ client, active, target, quote }: { client: RemoteClient; active: boolean; target?: RemoteBootstrap['agentTarget']; quote?: RemoteAgentQuote }) {
  const { gateway, setup, transport } = useMemo(() => createRemoteAgentGateway(client), [client])
  const { t, i18n } = useTranslation()
  const copy = remoteCopy(i18n.language.startsWith('zh') ? 'zh-CN' : 'en-US')
  const [access, setAccess] = useState<'checking' | 'allowed' | 'blocked'>('checking')
  const [accessError, setAccessError] = useState<unknown>()
  const [resources, setResources] = useState(emptyAgentResources)
  const [handledQuote, setHandledQuote] = useState<number>()
  const launch = useMemo<AgentLaunchIntent | undefined>(() => {
    if (!quote || quote.key === handledQuote) return undefined
    const resource = resources.ssh.find(item => item.session_id === quote.sessionId)
    if (!resource) return undefined
    return { key: quote.key, source: 'terminal_selection', target: { kind: 'new' }, text: quote.text,
      origin: { kind: 'terminal_selection', source_session_id: quote.sessionId, host_name: resource.host_name, captured_at: quote.capturedAt, line_count: quote.text.split('\n').length },
      resource_reference: { kind: 'ssh_session', session_id: quote.sessionId }, source_resource: resource }
  }, [quote, resources, handledQuote])
  const [ready, setReady] = useState(false)
  const [resourceFailed, setResourceFailed] = useState(false)
  const [viewFailed, setViewFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [resourceAttempt, setResourceAttempt] = useState(0)
  const visibleSessionRef = useRef<string | undefined>(undefined)
  const viewRequestRef = useRef(0)
  const [handled, setHandled] = useState('')
  useEffect(() => {
    const abort = new AbortController()
    setAccess('checking'); setAccessError(undefined)
    // 只查询被控端；控制端不需要配置模型、密钥或本机 AI Runtime。
    void setup.readiness(abort.signal).then(() => {
      if (!abort.signal.aborted) setAccess('allowed')
    }).catch(reason => {
      if (!abort.signal.aborted) { setAccessError(reason); setAccess('blocked') }
    })
    return () => abort.abort()
  }, [setup, attempt])
  const handledNotification = useCallback(() => setHandled(target?.id ?? ''), [target?.id])
  const visibleSession = useCallback((session?: string) => {
    visibleSessionRef.current = session
    const request = ++viewRequestRef.current
    void client.bridge.setAgentView?.(session, client.connection.id).then(result => {
      if (request === viewRequestRef.current) setViewFailed(!result.ok)
    }).catch(() => {
      if (request === viewRequestRef.current) setViewFailed(true)
    })
  }, [client])
  useEffect(() => () => { viewRequestRef.current++ }, [client])
  useEffect(() => {
    if (access !== 'allowed') return
    const abort = new AbortController()
    let pending = false
    const refresh = async () => {
      if (pending || abort.signal.aborted) return
      pending = true
      try {
        const next = await loadAgentResources(transport, abort.signal)
        if (!abort.signal.aborted) { setResources(next); setReady(true); setResourceFailed(false) }
      } catch (reason) {
        if (!abort.signal.aborted) {
          setReady(false); setResourceFailed(true)
          if (reason && typeof reason === 'object' && 'code' in reason && ['remote_agent_disabled', 'remote_agent_unsupported'].includes(String(reason.code))) {
            setAccessError(reason); setAccess('blocked')
          }
        }
      }
      finally { pending = false }
    }
    void refresh()
    const timer = setInterval(() => { if (active && !document.hidden) void refresh() }, 5000)
    return () => { abort.abort(); clearInterval(timer) }
  }, [transport, active, resourceAttempt, access])
  if (access !== 'allowed') return <section className={styles.surface} aria-label={copy.agent}>
    {access === 'checking' ? <Spin description={copy.agentChecking}><div className={styles['access-loading']} /></Spin>
      : <div className={styles['access-feedback']}><RemoteFeedback message={remoteErrorText(copy, accessError)} action={<Button size="small" onClick={() => setAttempt(value => value + 1)}>{t('app.retry')}</Button>} /></div>}
  </section>
  return <section className={styles.surface}>
    <div className={styles.toolbar}><RemoteAgentApprovals transport={transport} target={target} /></div>
    <div className={styles.workspace}><AgentPage launchIntent={launch} onLaunchIntentHandled={setHandledQuote} gateway={gateway} setupGateway={setup} enabled active={active} remote onVisibleSessionChange={visibleSession} notificationSessionId={target?.id !== handled ? target?.sessionId : undefined} onNotificationSessionHandled={handledNotification} sshResources={resources.ssh} fileResources={resources.files} slashCandidates={resources.catalog} sshResourcesReady={ready} fileResourcesReady={ready} sshProfileResourcesReady={ready} /></div>
    <RemoteFeedbackStack>
      {resourceFailed ? <RemoteFeedback message={copy.agentResourcesUnavailable} action={<Button size="small" onClick={() => setResourceAttempt(value => value + 1)}>{t('app.retry')}</Button>} /> : null}
      {viewFailed ? <RemoteFeedback message={copy.agentViewUnavailable} action={<Button size="small" onClick={() => visibleSession(visibleSessionRef.current)}>{t('app.retry')}</Button>} /> : null}
    </RemoteFeedbackStack>
  </section>
}
