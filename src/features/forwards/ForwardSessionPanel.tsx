import { ArrowDownUp, Cable, Network, Play, RadioTower, Route, Square } from 'lucide-react'
import { App as AntdApp, Button, Empty, Input, InputNumber, Progress, Segmented } from 'antd'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConnectionActionButton } from '../../components/ui/ConnectionActionButton'
import { StatusBadge } from '../../components/ui/StatusBadge'
import type { ForwardInstance, ForwardMode, ForwardStartRequest, Host, Session } from '../../types/domain'
import { formatBytes } from '../files/fileUtils'

interface ForwardSessionPanelProps {
  session: Session | null
  host?: Host
  forwards: ForwardInstance[]
  actionBusy: boolean
  onStartForward: (input: ForwardStartRequest) => Promise<ForwardInstance>
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

export function ForwardSessionPanel({
  session,
  host,
  forwards,
  actionBusy,
  onStartForward,
  onStopForward,
}: ForwardSessionPanelProps) {
  const { t } = useTranslation()
  const { notification } = AntdApp.useApp()
  const [form, setForm] = useState<SessionForwardForm>({ ...defaultSessionForwardForm })
  const sessionForwards = useMemo(
    () => forwards.filter((forward) => forward.session_id === session?.id),
    [forwards, session?.id],
  )
  const connectedSSH = Boolean(session?.kind === 'ssh' && session.status === 'connected')
  const unsupported = connectedSSH && host?.auth_method === 'system'
  const canCreate = connectedSSH && !unsupported

  const startForward = async () => {
    const validation = validateForm(form, t)
    if (validation) {
      notification.warning({ title: validation, duration: 3, role: 'status', className: 'termous-notification' })
      return
    }
    try {
      await onStartForward({
        scope: 'session',
        session_id: session?.id,
        name: t(`forwards.modeName.${form.mode}`),
        mode: form.mode,
        bind_host: form.bind_host,
        bind_port: Number(form.bind_port),
        target_host: form.mode === 'dynamic' ? '' : form.target_host,
        target_port: form.mode === 'dynamic' ? 0 : Number(form.target_port),
      })
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
      <div className="forward-session-empty">
        <Empty description={t('forwards.sessionEmpty')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </div>
    )
  }

  if (unsupported) {
    return (
      <div className="forward-session-empty">
        <Empty description={t('forwards.systemAuthSessionUnsupported')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </div>
    )
  }

  return (
    <section className="forward-session-panel">
      <div className="forward-session-editor">
        <div className="forward-session-title">
          <strong>{t('forwards.sessionCreateTitle')}</strong>
          <span>{host ? `${host.username}@${host.address}:${host.port}` : t('fields.none')}</span>
        </div>
        <Segmented
          block
          value={form.mode}
          onChange={(value) => setForm((current) => ({ ...current, mode: value as ForwardMode }))}
          options={[
            { label: t('forwards.modeName.local'), value: 'local' },
            { label: t('forwards.modeName.remote'), value: 'remote' },
            { label: t('forwards.modeName.dynamic'), value: 'dynamic' },
          ]}
        />
        <div className="forward-session-grid">
          <label className="forward-field">
            <span className="field-label">{form.mode === 'remote' ? t('forwards.remoteBindHost') : t('forwards.localBindHost')}</span>
            <Input value={form.bind_host} onChange={(event) => setForm((current) => ({ ...current, bind_host: event.target.value }))} />
          </label>
          <label className="forward-field">
            <span className="field-label">{form.mode === 'remote' ? t('forwards.remoteBindPort') : t('forwards.localBindPort')}</span>
            <InputNumber min={1} max={65535} value={form.bind_port} onChange={(value) => setForm((current) => ({ ...current, bind_port: value }))} />
          </label>
        </div>
        {form.mode !== 'dynamic' ? (
          <div className="forward-session-grid">
            <label className="forward-field">
              <span className="field-label">{t('forwards.targetHost')}</span>
              <Input value={form.target_host} onChange={(event) => setForm((current) => ({ ...current, target_host: event.target.value }))} />
            </label>
            <label className="forward-field">
              <span className="field-label">{t('forwards.targetPort')}</span>
              <InputNumber min={1} max={65535} value={form.target_port} onChange={(value) => setForm((current) => ({ ...current, target_port: value }))} />
            </label>
          </div>
        ) : (
          <div className="forwarding-socks-hint">
            <Network size={15} />
            <span>{t('forwards.dynamicHint')}</span>
          </div>
        )}
        <ConnectionActionButton disabled={!canCreate || actionBusy} icon={<Play size={15} />} onClick={() => void startForward()}>
          {t('forwards.startSessionForward')}
        </ConnectionActionButton>
      </div>

      <div className="forward-session-list">
        {sessionForwards.length === 0 ? (
          <div className="forward-session-empty-inline">{t('forwards.noSessionForwards')}</div>
        ) : (
          sessionForwards.map((forward) => (
            <SessionForwardRow key={forward.id} forward={forward} actionBusy={actionBusy} onStop={() => void onStopForward(forward.id)} />
          ))
        )}
      </div>
    </section>
  )
}

function SessionForwardRow({
  forward,
  actionBusy,
  onStop,
}: {
  forward: ForwardInstance
  actionBusy: boolean
  onStop: () => void
}) {
  const { t } = useTranslation()
  const Icon = forward.mode === 'local' ? Route : forward.mode === 'remote' ? RadioTower : Network
  const status = forward.status === 'running' ? 'connected' : forward.status === 'failed' ? 'failed' : 'connecting'
  return (
    <article className={`forward-session-row is-${forward.status}`}>
      <div className="forward-session-row-head">
        <span className="forward-session-row-mode">
          <Icon size={14} />
          {t(`forwards.modeName.${forward.mode}`)}
        </span>
        <StatusBadge status={status} label={t(`forwards.status.${forward.status}`)} />
      </div>
      <strong>{forward.bound_address || `${forward.bind_host}:${forward.bind_port}`}</strong>
      <span>{forward.mode === 'dynamic' ? 'SOCKS5' : `${forward.target_host}:${forward.target_port}`}</span>
      <Progress percent={Math.max(0, Math.min(100, forward.progress || 0))} showInfo={false} status={forward.status === 'failed' ? 'exception' : 'active'} />
      <div className="forward-session-row-meta">
        <span><Cable size={12} />{forward.active_connections}</span>
        <span><ArrowDownUp size={12} />{formatBytes(forward.bytes_in + forward.bytes_out)}</span>
        <Button className="danger-button" size="small" disabled={actionBusy || forward.status === 'stopping'} icon={<Square size={12} />} onClick={onStop}>
          {t('forwards.stop')}
        </Button>
      </div>
      {forward.last_error ? <p>{forward.last_error}</p> : null}
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
