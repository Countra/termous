import { Cable, ChevronDown, ChevronUp, Play, Plus } from 'lucide-react'
import { App as AntdApp, Button } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConnectionActionButton } from '../../components/ui/ConnectionActionButton'
import { StatusBadge } from '../../components/ui/StatusBadge'
import type { ForwardInstance, ForwardMode, ForwardStartRequest, Host, Session } from '../../types/domain'
import { WorkbenchEmptyState } from '../workbench/WorkbenchEmptyState'
import { ForwardEditorFields } from './ForwardEditorFields'
import { ForwardModeBadge, ForwardModeSelector } from './ForwardModeSelector'
import { ForwardRouteDiagram } from './ForwardRouteDiagram'
import { ForwardRuntimeActions } from './ForwardRuntimeActions'
import { ForwardRuntimeMetrics } from './ForwardRuntimeMetrics'
import { ForwardStateFeedback } from './ForwardStateFeedback'

interface ForwardSessionPanelProps {
  session: Session | null
  host?: Host
  forwards: ForwardInstance[]
  enabled: boolean
  actionBusy: boolean
  onStartForward: (input: ForwardStartRequest) => Promise<ForwardInstance>
  onRestartForward: (id: string) => Promise<void>
  onStopForward: (id: string) => Promise<void>
}

interface SessionForwardForm {
  mode: ForwardMode
  bind_host: string
  bind_port: number | null
  target_host: string
  target_port: number | null
}

const defaultSessionForwardForm: SessionForwardForm = {
  mode: 'local',
  bind_host: '127.0.0.1',
  bind_port: 8080,
  target_host: '127.0.0.1',
  target_port: 80,
}

const forwardStatusPriority: Record<ForwardInstance['status'], number> = {
  running: 0,
  starting: 1,
  waiting_host_trust: 2,
  stopping: 3,
  failed: 4,
  stopped: 5,
}

export function ForwardSessionPanel({
  session,
  host,
  forwards,
  enabled,
  actionBusy,
  onStartForward,
  onRestartForward,
  onStopForward,
}: ForwardSessionPanelProps) {
  const { t } = useTranslation()
  const { notification } = AntdApp.useApp()
  const sessionForwards = useMemo(
    () => forwards
      .filter((forward) => forward.session_id === session?.id)
      .sort((left, right) => forwardStatusPriority[left.status] - forwardStatusPriority[right.status]),
    [forwards, session?.id],
  )
  const [form, setForm] = useState<SessionForwardForm>({ ...defaultSessionForwardForm })
  const [composerOpen, setComposerOpen] = useState(() => sessionForwards.length === 0)
  const [revealForwardId, setRevealForwardId] = useState<string | null>(null)
  const previousSessionIdRef = useRef(session?.id)
  const composerTouchedRef = useRef(false)
  const composerToggleRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const connectedSSH = Boolean(session?.kind === 'ssh' && session.status === 'connected')
  const canCreate = connectedSSH

  useEffect(() => {
    if (previousSessionIdRef.current !== session?.id) {
      previousSessionIdRef.current = session?.id
      composerTouchedRef.current = false
      setForm({ ...defaultSessionForwardForm })
      setComposerOpen(sessionForwards.length === 0)
      setRevealForwardId(null)
      return
    }
    if (!composerTouchedRef.current) {
      setComposerOpen(sessionForwards.length === 0)
    }
  }, [session?.id, sessionForwards.length])

  useEffect(() => {
    if (!revealForwardId || !sessionForwards.some((forward) => forward.id === revealForwardId)) {
      return
    }
    const target = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-forward-id]') ?? [])
      .find((element) => element.dataset.forwardId === revealForwardId)
    target?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    setRevealForwardId(null)
  }, [revealForwardId, sessionForwards])

  const setComposerVisibility = (open: boolean) => {
    composerTouchedRef.current = true
    if (!open) {
      composerToggleRef.current?.focus()
    }
    setComposerOpen(open)
  }

  const startForward = async () => {
    const validation = validateForm(form, t)
    if (validation) {
      notification.warning({ title: validation, duration: 3, role: 'status', className: 'termous-notification' })
      return
    }
    try {
      const created = await onStartForward({
        scope: 'session',
        session_id: session?.id,
        name: t(`forwards.modeName.${form.mode}`),
        mode: form.mode,
        bind_host: form.bind_host,
        bind_port: Number(form.bind_port),
        target_host: form.mode === 'dynamic' ? '' : form.target_host,
        target_port: form.mode === 'dynamic' ? 0 : Number(form.target_port),
      })
      composerTouchedRef.current = false
      composerToggleRef.current?.focus()
      setComposerOpen(false)
      setRevealForwardId(created.id)
    } catch (error) {
      notification.error({
        title: t('forwards.startFailed'),
        description: error instanceof Error ? error.message : t('app.error'),
        duration: 5,
        role: 'alert',
        className: 'termous-notification',
      })
    }
  }

  if (!connectedSSH) {
    return (
      <WorkbenchEmptyState
        className="forward-session-empty"
        icon={<Cable size={20} />}
        title={t('workbench.detailsTabs.forwards')}
        description={t('forwards.sessionEmpty')}
      />
    )
  }

  const sessionTarget = host ? `${host.username}@${host.address}:${host.port}` : t('fields.none')

  return (
    <section className="forward-session-panel">
      <header className="forward-session-context">
        <div className="forward-session-context-copy">
          <span className="forward-session-context-icon"><Cable size={16} aria-hidden="true" /></span>
          <span>
            <strong>{sessionTarget}</strong>
            <small>{t('forwards.sessionCount', { count: sessionForwards.length })}</small>
          </span>
        </div>
        <Button
          ref={composerToggleRef}
          type="text"
          className="forward-session-composer-toggle"
          aria-expanded={composerOpen}
          icon={<Plus size={14} />}
          onClick={() => setComposerVisibility(!composerOpen)}
        >
          <span>{t('forwards.newForward')}</span>
          {composerOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </Button>
      </header>

      <div className={`forward-session-composer-shell${composerOpen ? ' is-open' : ''}`} aria-hidden={!composerOpen}>
        <div className="forward-session-composer-inner">
          <div className="forward-session-editor">
            <ForwardModeSelector
              compact
              value={form.mode}
              disabled={actionBusy}
              onChange={(mode) => setForm((current) => ({ ...current, mode }))}
            />
            <ForwardEditorFields
              compact
              idPrefix={`session-forward-${session?.id ?? 'none'}`}
              mode={form.mode}
              bind_host={form.bind_host}
              bind_port={form.bind_port}
              target_host={form.target_host}
              target_port={form.target_port}
              disabled={actionBusy}
              onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
            />
            <ConnectionActionButton disabled={!canCreate || actionBusy} icon={<Play size={15} />} onClick={() => void startForward()}>
              {t('forwards.startSessionForward')}
            </ConnectionActionButton>
          </div>
        </div>
      </div>

      <div ref={listRef} className="forward-session-list">
        {sessionForwards.length === 0 ? (
          <div className="forward-session-empty-inline">{t('forwards.noSessionForwards')}</div>
        ) : (
          sessionForwards.map((forward) => (
            <SessionForwardRow
              key={forward.id}
              forward={forward}
              enabled={enabled}
              actionBusy={actionBusy}
              onRestart={() => onRestartForward(forward.id)}
              onStop={() => onStopForward(forward.id)}
            />
          ))
        )}
      </div>
    </section>
  )
}

function SessionForwardRow({
  forward,
  enabled,
  actionBusy,
  onRestart,
  onStop,
}: {
  forward: ForwardInstance
  enabled: boolean
  actionBusy: boolean
  onRestart: () => Promise<void>
  onStop: () => Promise<void>
}) {
  const { t } = useTranslation()
  const status = forward.status === 'running' ? 'connected' : forward.status === 'failed' ? 'failed' : forward.status === 'stopped' ? 'disconnected' : 'connecting'

  return (
    <article className={`forward-session-row is-${forward.status}`} data-forward-id={forward.id}>
      <div className="forward-session-row-head">
        <ForwardModeBadge compact mode={forward.mode} />
        <div className="forward-session-row-actions">
          <StatusBadge status={status} label={t(`forwards.status.${forward.status}`)} />
          <ForwardRuntimeActions
            forward={forward}
            disabled={actionBusy}
            onRestart={onRestart}
            onStop={onStop}
          />
        </div>
      </div>
      <ForwardRouteDiagram
        compact
        mode={forward.mode}
        bindHost={forward.bind_host}
        bindPort={forward.bind_port}
        boundAddress={forward.bound_address}
        targetHost={forward.target_host}
        targetPort={forward.target_port}
      />
      <ForwardStateFeedback compact forward={forward} />
      <ForwardRuntimeMetrics compact enabled={enabled} forward={forward} showTiming={false} />
    </article>
  )
}

function validateForm(form: SessionForwardForm, t: (key: string) => string) {
  if (!validPort(form.bind_port)) {
    return t('forwards.validation.bindPort')
  }
  if (form.mode !== 'dynamic' && !form.target_host.trim()) {
    return t('forwards.validation.targetHost')
  }
  if (form.mode !== 'dynamic' && !validPort(form.target_port)) {
    return t('forwards.validation.targetPort')
  }
  return ''
}

function validPort(value: number | null) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65535
}
