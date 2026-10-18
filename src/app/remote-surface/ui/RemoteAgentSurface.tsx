import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Spin } from 'antd'
import { Bot, RefreshCw } from 'lucide-react'
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
  const [attempt, setAttempt] = useState(0)
  const [resourceAttempt, setResourceAttempt] = useState(0)
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
    <div className={styles['access-state']}>
      <span className={styles['access-mark']}><Bot size={26} /></span>
      {access === 'checking' ? <><h2 role="status">{copy.agentChecking}</h2><Spin /></>
        : <><h2>{copy.agentUnavailable}</h2><p role="alert">{remoteErrorText(copy, accessError)}</p><Button icon={<RefreshCw size={14} />} onClick={() => setAttempt(value => value + 1)}>{t('app.retry')}</Button></>}
    </div>
  </section>
  return <section className={styles.surface}>
    <div className={styles.toolbar}><span className={styles.title}><Bot size={17} />{copy.agent}</span><RemoteAgentApprovals transport={transport} target={target} /></div>
    <div className={styles.workspace}><AgentPage launchIntent={launch} onLaunchIntentHandled={setHandledQuote} gateway={gateway} setupGateway={setup} enabled active={active} remote notificationSessionId={target?.id !== handled ? target?.sessionId : undefined} onNotificationSessionHandled={handledNotification} sshResources={resources.ssh} fileResources={resources.files} slashCandidates={resources.catalog} sshResourcesReady={ready} fileResourcesReady={ready} sshProfileResourcesReady={ready} /></div>
    <RemoteFeedbackStack>
      {resourceFailed ? <RemoteFeedback message={copy.agentResourcesUnavailable} action={<Button size="small" onClick={() => setResourceAttempt(value => value + 1)}>{t('app.retry')}</Button>} /> : null}
    </RemoteFeedbackStack>
  </section>
}
