import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Cable,
  CircleDot,
  Clock3,
  Edit3,
  Network,
  Play,
  Plus,
  RadioTower,
  Route,
  Square,
  Timer,
  Trash2,
} from 'lucide-react'
import { App as AntdApp, Button, Empty, Input, InputNumber, Modal, Popconfirm, Progress, Segmented, Tooltip } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConnectionActionButton } from '../../components/ui/ConnectionActionButton'
import { CustomSelect } from '../../components/ui/CustomSelect'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { ForwardRouteDiagram } from './ForwardRouteDiagram'
import type {
  AppData,
  ForwardInstance,
  ForwardMode,
  ForwardProfile,
  ForwardProfileInput,
  ForwardStartRequest,
} from '../../types/domain'
import { formatBytes } from '../files/fileUtils'
import { formatForwardDuration, useForwardDurationTick } from './forwardTiming'

type EditorMode = 'profile' | 'temporary'

interface ForwardingPageProps {
  data: AppData
  actionBusy: boolean
  temporaryIntent?: { key: number; hostId: string } | null
  onCreateProfile: (input: ForwardProfileInput) => Promise<ForwardProfile>
  onUpdateProfile: (id: string, input: ForwardProfileInput) => Promise<ForwardProfile>
  onDeleteProfile: (id: string) => Promise<void>
  onStartForward: (input: ForwardStartRequest) => Promise<ForwardInstance>
  onStopForward: (id: string) => Promise<void>
}

interface ForwardFormState {
  name: string
  description: string
  mode: ForwardMode
  host_id: string
  bind_host: string
  bind_port: number | null
  target_host: string
  target_port: number | null
}

const defaultForm: ForwardFormState = {
  name: '',
  description: '',
  mode: 'local',
  host_id: '',
  bind_host: '127.0.0.1',
  bind_port: 8080,
  target_host: '127.0.0.1',
  target_port: 80,
}

const activeStatuses = new Set(['starting', 'running', 'stopping'])

export function ForwardingPage({
  data,
  actionBusy,
  temporaryIntent,
  onCreateProfile,
  onUpdateProfile,
  onDeleteProfile,
  onStartForward,
  onStopForward,
}: ForwardingPageProps) {
  const { t } = useTranslation()
  const { notification } = AntdApp.useApp()
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorMode, setEditorMode] = useState<EditorMode>('profile')
  const [editingProfile, setEditingProfile] = useState<ForwardProfile | null>(null)
  const [form, setForm] = useState<ForwardFormState>(() => ({ ...defaultForm }))
  const consumedTemporaryIntentKeyRef = useRef<number | null>(null)
  const hostOptions = useMemo(
    () => data.hosts.map((host) => ({ value: host.id, label: host.name, description: `${host.username}@${host.address}:${host.port}` })),
    [data.hosts],
  )
  const runningForwards = data.forwards.filter((forward) => activeStatuses.has(forward.status))
  const stoppedForwards = data.forwards.filter((forward) => !activeStatuses.has(forward.status)).slice(0, 8)
  const durationNow = useForwardDurationTick(runningForwards.length > 0)

  const openCreateProfile = () => {
    setEditorMode('profile')
    setEditingProfile(null)
    setForm({ ...defaultForm, host_id: data.hosts[0]?.id ?? '' })
    setEditorOpen(true)
  }

  const openTemporaryForward = () => {
    setEditorMode('temporary')
    setEditingProfile(null)
    setForm({ ...defaultForm, name: t('forwards.temporaryDefaultName'), host_id: data.hosts[0]?.id ?? '' })
    setEditorOpen(true)
  }

  useEffect(() => {
    if (!temporaryIntent) {
      return
    }
    if (consumedTemporaryIntentKeyRef.current === temporaryIntent.key) {
      return
    }
    consumedTemporaryIntentKeyRef.current = temporaryIntent.key
    setEditorMode('temporary')
    setEditingProfile(null)
    setForm({ ...defaultForm, name: t('forwards.temporaryDefaultName'), host_id: temporaryIntent.hostId })
    setEditorOpen(true)
  }, [t, temporaryIntent])

  const openEditProfile = (profile: ForwardProfile) => {
    setEditorMode('profile')
    setEditingProfile(profile)
    setForm({
      name: profile.name,
      description: profile.description ?? '',
      mode: profile.mode,
      host_id: profile.host_id,
      bind_host: profile.bind_host,
      bind_port: profile.bind_port,
      target_host: profile.target_host ?? '127.0.0.1',
      target_port: profile.target_port ?? 80,
    })
    setEditorOpen(true)
  }

  const saveEditor = async () => {
    const validation = validateForwardForm(form, t)
    if (validation) {
      notification.warning({ title: validation, duration: 3, role: 'status', className: 'termous-notification' })
      return
    }
    try {
      const input = formToInput(form)
      if (editorMode === 'temporary') {
        await onStartForward({ ...input, scope: 'background_once' })
        setEditorOpen(false)
        return
      }
      if (editingProfile) {
        await onUpdateProfile(editingProfile.id, input)
      } else {
        await onCreateProfile(input)
      }
      setEditorOpen(false)
    } catch (error) {
      notification.error({
        title: t('app.error'),
        description: error instanceof Error ? error.message : t('app.error'),
        duration: 5,
        role: 'alert',
        className: 'termous-notification',
      })
    }
  }

  const startForwardProfile = async (profile: ForwardProfile) => {
    try {
      await onStartForward({ profile_id: profile.id, scope: 'background_profile' })
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

  const hostById = (hostId?: string) => data.hosts.find((host) => host.id === hostId)

  return (
    <section className="forwarding-page">
      <div className="forwarding-page-header">
        <div>
          <h1>{t('forwards.title')}</h1>
          <p>{t('forwards.subtitle')}</p>
        </div>
        <div className="page-actions">
          <Button className="secondary-button" disabled={actionBusy || data.hosts.length === 0} icon={<Plus size={16} />} onClick={openTemporaryForward}>
            {t('forwards.newTemporary')}
          </Button>
          <ConnectionActionButton disabled={actionBusy || data.hosts.length === 0} icon={<Plus size={16} />} onClick={openCreateProfile}>
            {t('forwards.newProfile')}
          </ConnectionActionButton>
        </div>
      </div>

      <div className="forwarding-grid">
        <aside className="forwarding-panel forwarding-profiles-panel">
          <PanelTitle icon={<Route size={18} />} title={t('forwards.profiles')} hint={t('forwards.profilesHint')} />
          {data.forwardProfiles.length === 0 ? (
            <div className="forwarding-empty">
              <Empty description={t('forwards.noProfiles')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
            </div>
          ) : (
            <div className="forwarding-profile-list">
              {data.forwardProfiles.map((profile) => {
                const host = hostById(profile.host_id)
                const running = runningForwards.find((forward) => forward.profile_id === profile.id)
                const unsupported = host?.auth_method === 'system'
                return (
                  <article key={profile.id} className="forwarding-profile-card">
                    <div className="forwarding-card-topline">
                      <ModeBadge mode={profile.mode} />
                      <span>{host?.name ?? t('fields.none')}</span>
                    </div>
                    <div className="forwarding-card-title">
                      <strong>{profile.name}</strong>
                    </div>
                    <ForwardRouteDiagram
                      mode={profile.mode}
                      bindHost={profile.bind_host}
                      bindPort={profile.bind_port}
                      targetHost={profile.target_host}
                      targetPort={profile.target_port}
                    />
                    {profile.description ? <p>{profile.description}</p> : null}
                    {unsupported ? <span className="forwarding-card-warning">{t('forwards.systemAuthUnsupported')}</span> : null}
                    <div className="forwarding-card-actions">
                      <Button
                        className="secondary-button"
                        disabled={actionBusy || Boolean(running) || unsupported}
                        icon={<Play size={14} />}
                        onClick={() => void startForwardProfile(profile)}
                      >
                        {running ? t('forwards.running') : t('forwards.start')}
                      </Button>
                      <Button className="secondary-button" disabled={actionBusy} icon={<Edit3 size={14} />} onClick={() => openEditProfile(profile)}>
                        {t('app.update')}
                      </Button>
                      <Popconfirm
                        title={t('forwards.deleteProfileTitle')}
                        description={t('forwards.deleteProfileDescription')}
                        okText={t('app.delete')}
                        cancelText={t('app.cancel')}
                        okButtonProps={{ danger: true }}
                        onConfirm={() => void onDeleteProfile(profile.id)}
                      >
                        <Button className="danger-button" disabled={actionBusy} icon={<Trash2 size={14} />}>
                          {t('app.delete')}
                        </Button>
                      </Popconfirm>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </aside>

        <main className="forwarding-panel forwarding-runtime-panel">
          <PanelTitle
            icon={<Activity size={18} />}
            title={t('forwards.runtime')}
            hint={t('forwards.runtimeHint', { count: runningForwards.length })}
          />
          <div className="forwarding-runtime-summary">
            <SummaryMetric label={t('forwards.active')} value={String(runningForwards.length)} />
            <SummaryMetric label={t('forwards.connections')} value={String(data.forwards.reduce((sum, item) => sum + item.active_connections, 0))} />
            <SummaryMetric label={t('forwards.sent')} value={formatBytes(data.forwards.reduce((sum, item) => sum + item.bytes_out, 0))} />
            <SummaryMetric label={t('forwards.received')} value={formatBytes(data.forwards.reduce((sum, item) => sum + item.bytes_in, 0))} />
          </div>
          <div className="forwarding-runtime-list">
            {runningForwards.length === 0 ? (
              <div className="forwarding-empty">
                <Empty description={t('forwards.noRunning')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
              </div>
            ) : (
              runningForwards.map((forward) => (
                <ForwardRuntimeCard
                  key={forward.id}
                  forward={forward}
                  hostName={hostById(forward.host_id)?.name ?? t('fields.none')}
                  now={durationNow}
                  actionBusy={actionBusy}
                  onStop={() => void onStopForward(forward.id)}
                />
              ))
            )}
          </div>
          {stoppedForwards.length > 0 ? (
            <div className="forwarding-history">
              <h3>{t('forwards.recent')}</h3>
              {stoppedForwards.map((forward) => (
                <div key={forward.id} className="forwarding-history-row">
                  <ModeBadge mode={forward.mode} />
                  <span>{forward.name}</span>
                  <StatusBadge status={forward.status === 'failed' ? 'failed' : 'disconnected'} label={t(`forwards.status.${forward.status}`)} />
                </div>
              ))}
            </div>
          ) : null}
        </main>
      </div>

      <Modal
        centered
        open={editorOpen}
        width={620}
        className="termous-modal forwarding-modal"
        title={editorMode === 'temporary' ? t('forwards.temporaryTitle') : editingProfile ? t('forwards.editProfile') : t('forwards.newProfile')}
        okText={editorMode === 'temporary' ? t('forwards.start') : t('app.save')}
        cancelText={t('app.cancel')}
        okButtonProps={{ disabled: actionBusy }}
        onOk={() => void saveEditor()}
        onCancel={() => setEditorOpen(false)}
      >
        <ForwardEditorForm
          form={form}
          hosts={data.hosts}
          hostOptions={hostOptions}
          onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
        />
      </Modal>
    </section>
  )
}

function ForwardEditorForm({
  form,
  hosts,
  hostOptions,
  onChange,
}: {
  form: ForwardFormState
  hosts: AppData['hosts']
  hostOptions: Array<{ value: string; label: string; description?: string }>
  onChange: (patch: Partial<ForwardFormState>) => void
}) {
  const { t } = useTranslation()
  const selectedHost = hosts.find((host) => host.id === form.host_id)
  return (
    <div className="forwarding-editor-form">
      <label className="forward-field">
        <span className="field-label">{t('forwards.name')}</span>
        <Input
          id="forward-name"
          name="forward-name"
          value={form.name}
          onChange={(event) => onChange({ name: event.target.value })}
          placeholder={t('forwards.namePlaceholder')}
        />
      </label>
      <label className="forward-field">
        <span className="field-label">{t('forwards.mode')}</span>
        <Segmented
          block
          value={form.mode}
          onChange={(value) => onChange({ mode: value as ForwardMode })}
          options={[
            { label: t('forwards.modeName.local'), value: 'local' },
            { label: t('forwards.modeName.remote'), value: 'remote' },
            { label: t('forwards.modeName.dynamic'), value: 'dynamic' },
          ]}
        />
      </label>
      <CustomSelect
        label={t('forwards.host')}
        value={form.host_id}
        options={hostOptions}
        onChange={(value) => onChange({ host_id: value })}
        disabled={hostOptions.length === 0}
      />
      {selectedHost?.auth_method === 'system' ? <p className="forwarding-card-warning">{t('forwards.systemAuthUnsupported')}</p> : null}
      <div className="forward-form-grid">
        <label className="forward-field">
          <span className="field-label">{form.mode === 'remote' ? t('forwards.remoteBindHost') : t('forwards.localBindHost')}</span>
          <Input
            id="forward-bind-host"
            name="forward-bind-host"
            value={form.bind_host}
            onChange={(event) => onChange({ bind_host: event.target.value })}
          />
        </label>
        <label className="forward-field">
          <span className="field-label">{form.mode === 'remote' ? t('forwards.remoteBindPort') : t('forwards.localBindPort')}</span>
          <InputNumber
            id="forward-bind-port"
            name="forward-bind-port"
            min={1}
            max={65535}
            value={form.bind_port}
            onChange={(value) => onChange({ bind_port: value })}
          />
        </label>
      </div>
      {form.mode !== 'dynamic' ? (
        <div className="forward-form-grid">
          <label className="forward-field">
            <span className="field-label">{t('forwards.targetHost')}</span>
            <Input
              id="forward-target-host"
              name="forward-target-host"
              value={form.target_host}
              onChange={(event) => onChange({ target_host: event.target.value })}
            />
          </label>
          <label className="forward-field">
            <span className="field-label">{t('forwards.targetPort')}</span>
            <InputNumber
              id="forward-target-port"
              name="forward-target-port"
              min={1}
              max={65535}
              value={form.target_port}
              onChange={(value) => onChange({ target_port: value })}
            />
          </label>
        </div>
      ) : (
        <div className="forwarding-socks-hint">
          <Network size={16} />
          <span>{t('forwards.dynamicHint')}</span>
        </div>
      )}
      <label className="forward-field">
        <span className="field-label">{t('forwards.description')}</span>
        <Input.TextArea
          id="forward-description"
          name="forward-description"
          rows={3}
          value={form.description}
          onChange={(event) => onChange({ description: event.target.value })}
        />
      </label>
    </div>
  )
}

function ForwardRuntimeCard({
  forward,
  hostName,
  now,
  actionBusy,
  onStop,
}: {
  forward: ForwardInstance
  hostName: string
  now: number
  actionBusy: boolean
  onStop: () => void
}) {
  const { t } = useTranslation()
  const progressStatus = forward.status === 'failed' ? 'exception' : forward.status === 'running' ? 'success' : 'active'
  const modeLabel = t(`forwards.modeName.${forward.mode}`)
  const forwardName = forward.name.trim()
  const showForwardName = forwardName !== '' && forwardName !== modeLabel
  return (
    <article className={`forwarding-runtime-card is-${forward.status}`}>
      <div className="forwarding-runtime-top">
        <ModeBadge mode={forward.mode} />
        <StatusBadge status={forward.status === 'running' ? 'connected' : forward.status === 'failed' ? 'failed' : 'connecting'} label={t(`forwards.status.${forward.status}`)} />
      </div>
      <div className="forwarding-runtime-title">
        <div>
          <strong>{showForwardName ? forwardName : hostName}</strong>
          {showForwardName ? <span>{hostName}</span> : null}
        </div>
        <Tooltip title={t('forwards.stop')}>
          <Button className="danger-button" disabled={actionBusy || forward.status === 'stopping'} icon={<Square size={13} />} onClick={onStop}>
            {t('forwards.stop')}
          </Button>
        </Tooltip>
      </div>
      <ForwardRouteDiagram
        mode={forward.mode}
        bindHost={forward.bind_host}
        bindPort={forward.bind_port}
        boundAddress={forward.bound_address}
        targetHost={forward.target_host}
        targetPort={forward.target_port}
      />
      <Progress percent={Math.max(0, Math.min(100, forward.progress || 0))} showInfo={false} status={progressStatus} />
      <div className="forwarding-runtime-metrics">
        <span><CircleDot size={13} />{t('forwards.phaseName.' + forward.phase)}</span>
        <span><Cable size={13} />{forward.active_connections}</span>
        <span><ArrowUpRight size={13} /><small>{t('forwards.sent')}</small>{formatBytes(forward.bytes_out)}</span>
        <span><ArrowDownLeft size={13} /><small>{t('forwards.received')}</small>{formatBytes(forward.bytes_in)}</span>
        <span><Clock3 size={13} /><small>{t('forwards.startedAt')}</small>{formatTime(forward.started_at)}</span>
        <span><Timer size={13} /><small>{t('forwards.duration')}</small>{formatForwardDuration(forward.started_at, now)}</span>
      </div>
      {forward.last_error ? <p className="forwarding-runtime-error">{forward.last_error}</p> : null}
    </article>
  )
}

function PanelTitle({ icon, title, hint }: { icon: JSX.Element; title: string; hint: string }) {
  return (
    <div className="forwarding-panel-title">
      <span>{icon}</span>
      <div>
        <h2>{title}</h2>
        <p>{hint}</p>
      </div>
    </div>
  )
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <strong>{value}</strong>
      <small>{label}</small>
    </span>
  )
}

function ModeBadge({ mode }: { mode: ForwardMode }) {
  const { t } = useTranslation()
  const Icon = mode === 'local' ? Route : mode === 'remote' ? RadioTower : Network
  return (
    <span className={`forward-mode-badge is-${mode}`}>
      <Icon size={14} />
      {t(`forwards.modeName.${mode}`)}
    </span>
  )
}

function formToInput(form: ForwardFormState): ForwardProfileInput {
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    mode: form.mode,
    host_id: form.host_id,
    bind_host: form.bind_host.trim(),
    bind_port: Number(form.bind_port),
    target_host: form.mode === 'dynamic' ? '' : form.target_host.trim(),
    target_port: form.mode === 'dynamic' ? 0 : Number(form.target_port),
  }
}

function validateForwardForm(form: ForwardFormState, t: (key: string) => string) {
  if (!form.name.trim()) {
    return t('forwards.validation.name')
  }
  if (!form.host_id) {
    return t('forwards.validation.host')
  }
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

function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
