import {
  Activity,
  Cable,
  Edit3,
  Gauge,
  Play,
  Plus,
  Route,
  Search,
  Trash2,
} from 'lucide-react'
import { App as AntdApp, Button, Empty, Input, Modal, Popconfirm, Tabs, Tooltip } from 'antd'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ConnectionActionButton } from '../../components/ui/ConnectionActionButton'
import { CustomSelect } from '../../components/ui/CustomSelect'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { ForwardEditorFields } from './ForwardEditorFields'
import { ForwardModeBadge, ForwardModeSelector } from './ForwardModeSelector'
import { ForwardRouteDiagram } from './ForwardRouteDiagram'
import { ForwardRuntimeActions } from './ForwardRuntimeActions'
import { ForwardRuntimeMetrics } from './ForwardRuntimeMetrics'
import { ForwardStateFeedback } from './ForwardStateFeedback'
import type {
  AppData,
  ForwardInstance,
  ForwardMode,
  ForwardProfile,
  ForwardProfileInput,
  ForwardStartRequest,
} from '../../types/domain'
import { useForwardDurationTick } from './forwardTiming'

type EditorMode = 'profile' | 'temporary'
type ForwardModeFilter = 'all' | ForwardMode

interface ForwardingPageProps {
  data: AppData
  actionBusy: boolean
  temporaryIntent?: { key: number; hostId: string } | null
  onCreateProfile: (input: ForwardProfileInput) => Promise<ForwardProfile>
  onUpdateProfile: (id: string, input: ForwardProfileInput) => Promise<ForwardProfile>
  onDeleteProfile: (id: string) => Promise<void>
  onStartForward: (input: ForwardStartRequest) => Promise<ForwardInstance>
  onRestartForward: (id: string) => Promise<void>
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

const activeStatuses = new Set(['starting', 'waiting_host_trust', 'running', 'stopping'])

export function ForwardingPage({
  data,
  actionBusy,
  temporaryIntent,
  onCreateProfile,
  onUpdateProfile,
  onDeleteProfile,
  onStartForward,
  onRestartForward,
  onStopForward,
}: ForwardingPageProps) {
  const { t } = useTranslation()
  const { notification } = AntdApp.useApp()
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorMode, setEditorMode] = useState<EditorMode>('profile')
  const [editingProfile, setEditingProfile] = useState<ForwardProfile | null>(null)
  const [form, setForm] = useState<ForwardFormState>(() => ({ ...defaultForm }))
  const [searchValue, setSearchValue] = useState('')
  const [modeFilter, setModeFilter] = useState<ForwardModeFilter>('all')
  const consumedTemporaryIntentKeyRef = useRef<number | null>(null)
  const hostOptions = useMemo(
    () => data.hosts.map((host) => ({ value: host.id, label: host.name, description: `${host.username}@${host.address}:${host.port}` })),
    [data.hosts],
  )
  const hostLookup = useMemo(() => new Map(data.hosts.map((host) => [host.id, host])), [data.hosts])
  const runningForwards = useMemo(
    () => data.forwards.filter((forward) => activeStatuses.has(forward.status)),
    [data.forwards],
  )
  const normalizedSearch = searchValue.trim().toLocaleLowerCase()
  const filteredProfiles = useMemo(
    () => data.forwardProfiles.filter((profile) => (
      matchesMode(profile.mode, modeFilter)
      && matchesForwardProfile(profile, profile.host_id ? hostLookup.get(profile.host_id) : undefined, normalizedSearch)
    )),
    [data.forwardProfiles, hostLookup, modeFilter, normalizedSearch],
  )
  const filteredRunningForwards = useMemo(
    () => runningForwards.filter((forward) => (
      matchesMode(forward.mode, modeFilter)
      && matchesForwardInstance(forward, forward.host_id ? hostLookup.get(forward.host_id) : undefined, normalizedSearch)
    )),
    [hostLookup, modeFilter, normalizedSearch, runningForwards],
  )
  const activeConnections = runningForwards.reduce((sum, forward) => sum + forward.active_connections, 0)
  const filteredCount = filteredProfiles.length + filteredRunningForwards.length
  const searchableCount = data.forwardProfiles.length + runningForwards.length
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

  const hostById = (hostId?: string) => hostId ? hostLookup.get(hostId) : undefined

  return (
    <section className="forwarding-page">
      <div className="forwarding-commandbar">
        <div className="forwarding-command-primary">
          <div className="forwarding-overview-strip" aria-label={t('forwards.overview')}>
            <OverviewMetric icon={<Route size={16} />} label={t('forwards.profiles')} value={String(data.forwardProfiles.length)} />
            <OverviewMetric icon={<Activity size={16} />} label={t('forwards.active')} value={String(runningForwards.length)} />
            <OverviewMetric icon={<Cable size={16} />} label={t('forwards.connections')} value={String(activeConnections)} />
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
        <div className="forwarding-filterbar">
          <Input
            allowClear
            className="forwarding-search"
            prefix={<Search size={15} aria-hidden="true" />}
            value={searchValue}
            aria-label={t('forwards.searchPlaceholder')}
            placeholder={t('forwards.searchPlaceholder')}
            onChange={(event) => setSearchValue(event.target.value)}
          />
          <Tabs
            className="credential-filter-tabs forwarding-mode-tabs"
            activeKey={modeFilter}
            animated={{ inkBar: true, tabPane: false }}
            aria-label={t('forwards.modeFilter')}
            onChange={(value) => setModeFilter(value as ForwardModeFilter)}
            items={[
              { label: t('forwards.allModes'), key: 'all' },
              { label: t('forwards.modeName.local'), key: 'local' },
              { label: t('forwards.modeName.remote'), key: 'remote' },
              { label: t('forwards.modeName.dynamic'), key: 'dynamic' },
            ]}
          />
          <span className="forwarding-filter-count">
            {t('forwards.filteredCount', { count: filteredCount, total: searchableCount })}
          </span>
        </div>
      </div>

      <div className="forwarding-workspace-grid">
        <ForwardWorkspacePane
          className="is-profiles"
          icon={<Route size={17} />}
          title={t('forwards.profiles')}
          hint={t('forwards.profilesHint')}
          count={filteredProfiles.length}
        >
          {filteredProfiles.length === 0 ? (
            <ForwardingEmpty
              description={data.forwardProfiles.length === 0 ? t('forwards.noProfiles') : t('forwards.noProfileResults')}
            />
          ) : (
            <div className="forwarding-profile-list">
              {filteredProfiles.map((profile) => (
                <ForwardProfileRow
                  key={profile.id}
                  profile={profile}
                  host={hostById(profile.host_id)}
                  running={runningForwards.find((forward) => forward.profile_id === profile.id)}
                  actionBusy={actionBusy}
                  onStart={() => void startForwardProfile(profile)}
                  onEdit={() => openEditProfile(profile)}
                  onDelete={() => void onDeleteProfile(profile.id)}
                />
              ))}
            </div>
          )}
        </ForwardWorkspacePane>

        <ForwardWorkspacePane
          className="is-running"
          icon={<Gauge size={17} />}
          title={t('forwards.runtime')}
          hint={t('forwards.runtimeHint', { count: runningForwards.length })}
          count={filteredRunningForwards.length}
        >
          {filteredRunningForwards.length === 0 ? (
            <ForwardingEmpty
              description={runningForwards.length === 0 ? t('forwards.noRunning') : t('forwards.noRunningResults')}
            />
          ) : (
            <div className="forwarding-runtime-list">
              {filteredRunningForwards.map((forward) => (
                <ForwardRuntimeRow
                  key={forward.id}
                  forward={forward}
                  hostName={hostById(forward.host_id)?.name ?? t('fields.none')}
                  now={durationNow}
                  actionBusy={actionBusy}
                  onRestart={() => onRestartForward(forward.id)}
                  onStop={() => onStopForward(forward.id)}
                />
              ))}
            </div>
          )}
        </ForwardWorkspacePane>
      </div>

      <Modal
        centered
        open={editorOpen}
        width={580}
        className="termous-modal forwarding-modal"
        title={
          <span className="forwarding-modal-title">
            <span className="forwarding-modal-title-icon" aria-hidden="true">
              <Cable size={18} strokeWidth={2.15} />
            </span>
            <span>
              {editorMode === 'temporary'
                ? t('forwards.temporaryTitle')
                : editingProfile
                  ? t('forwards.editProfile')
                  : t('forwards.newProfile')}
            </span>
          </span>
        }
        okText={editorMode === 'temporary' ? t('forwards.start') : t('app.save')}
        cancelText={t('app.cancel')}
        okButtonProps={{ disabled: actionBusy }}
        onOk={() => void saveEditor()}
        onCancel={() => setEditorOpen(false)}
      >
        <ForwardEditorForm
          form={form}
          hostOptions={hostOptions}
          onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
        />
      </Modal>
    </section>
  )
}

function ForwardEditorForm({
  form,
  hostOptions,
  onChange,
}: {
  form: ForwardFormState
  hostOptions: Array<{ value: string; label: string; description?: string }>
  onChange: (patch: Partial<ForwardFormState>) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="forwarding-editor-form">
      <section className="forwarding-editor-section is-basic">
        <header className="forwarding-editor-section-header">
          <span className="forwarding-editor-section-icon" aria-hidden="true">
            <Activity size={15} />
          </span>
          <span className="forwarding-editor-section-title">{t('forwards.basicInfo')}</span>
        </header>
        <div className="forwarding-editor-basic-grid">
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
          <CustomSelect
            label={t('forwards.host')}
            value={form.host_id}
            options={hostOptions}
            onChange={(value) => onChange({ host_id: value })}
            disabled={hostOptions.length === 0}
          />
        </div>
        <label className="forward-field">
          <span className="field-label">{t('forwards.mode')}</span>
          <ForwardModeSelector value={form.mode} onChange={(mode) => onChange({ mode })} />
        </label>
      </section>

      <section className="forwarding-editor-section is-endpoints">
        <header className="forwarding-editor-section-header">
          <span className="forwarding-editor-section-icon" aria-hidden="true">
            <Route size={15} />
          </span>
          <span className="forwarding-editor-section-title">{t('forwards.endpointSettings')}</span>
        </header>
        <ForwardRouteDiagram
          mode={form.mode}
          bindHost={form.bind_host}
          bindPort={form.bind_port}
          targetHost={form.target_host}
          targetPort={form.target_port ?? undefined}
        />
        <ForwardEditorFields
          idPrefix="forward-editor"
          mode={form.mode}
          bind_host={form.bind_host}
          bind_port={form.bind_port}
          target_host={form.target_host}
          target_port={form.target_port}
          onChange={onChange}
        />
        <label className="forward-field">
          <span className="field-label">{t('forwards.description')}</span>
          <Input.TextArea
            id="forward-description"
            name="forward-description"
            autoSize={{ minRows: 3, maxRows: 5 }}
            value={form.description}
            onChange={(event) => onChange({ description: event.target.value })}
          />
        </label>
      </section>
    </div>
  )
}

function ForwardProfileRow({
  profile,
  host,
  running,
  actionBusy,
  onStart,
  onEdit,
  onDelete,
}: {
  profile: ForwardProfile
  host?: AppData['hosts'][number]
  running?: ForwardInstance
  actionBusy: boolean
  onStart: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const startHint = running ? t('forwards.running') : t('forwards.start')
  const secondary = [host?.name ?? t('fields.none'), profile.description].filter(Boolean).join(' · ')

  return (
    <article className="forwarding-profile-row">
      <div className="forwarding-row-heading">
        <div className="forwarding-row-title">
          <strong>{profile.name}</strong>
          <Tooltip title={secondary} mouseEnterDelay={0.35} classNames={{ root: 'forward-route-tooltip' }}>
            <span>{secondary}</span>
          </Tooltip>
        </div>
        <div className="forwarding-row-actions">
          {running ? <StatusBadge status="connected" label={t('forwards.running')} /> : null}
          <Tooltip title={startHint} mouseEnterDelay={0.3} classNames={{ root: 'forward-route-tooltip' }}>
            <span>
              <Button
                type="text"
                className="forwarding-row-action is-start"
                aria-label={startHint}
                disabled={actionBusy || Boolean(running)}
                icon={<Play size={14} />}
                onClick={onStart}
              />
            </span>
          </Tooltip>
          <Tooltip title={t('app.update')} mouseEnterDelay={0.3} classNames={{ root: 'forward-route-tooltip' }}>
            <Button
              type="text"
              className="forwarding-row-action"
              aria-label={t('app.update')}
              disabled={actionBusy}
              icon={<Edit3 size={14} />}
              onClick={onEdit}
            />
          </Tooltip>
          <Popconfirm
            title={t('forwards.deleteProfileTitle')}
            description={t('forwards.deleteProfileDescription')}
            okText={t('app.delete')}
            cancelText={t('app.cancel')}
            okButtonProps={{ danger: true }}
            onConfirm={onDelete}
          >
            <Tooltip title={t('app.delete')} mouseEnterDelay={0.3} classNames={{ root: 'forward-route-tooltip' }}>
              <Button
                type="text"
                danger
                className="forwarding-row-action"
                aria-label={t('app.delete')}
                disabled={actionBusy}
                icon={<Trash2 size={14} />}
              />
            </Tooltip>
          </Popconfirm>
        </div>
      </div>
      <div className="forwarding-row-mode"><ForwardModeBadge compact mode={profile.mode} /></div>
      <ForwardRouteDiagram
        compact
        mode={profile.mode}
        bindHost={profile.bind_host}
        bindPort={profile.bind_port}
        targetHost={profile.target_host}
        targetPort={profile.target_port}
      />
    </article>
  )
}

function ForwardRuntimeRow({
  forward,
  hostName,
  now,
  actionBusy,
  onRestart,
  onStop,
}: {
  forward: ForwardInstance
  hostName: string
  now: number
  actionBusy: boolean
  onRestart: () => Promise<void>
  onStop: () => Promise<void>
}) {
  const { t } = useTranslation()
  const modeLabel = t(`forwards.modeName.${forward.mode}`)
  const forwardName = forward.name.trim()
  const showForwardName = forwardName !== '' && forwardName !== modeLabel
  return (
    <article className={`forwarding-runtime-row is-${forward.status}`}>
      <div className="forwarding-row-heading">
        <div className="forwarding-row-title">
          <strong>{showForwardName ? forwardName : hostName}</strong>
          {showForwardName ? <span>{hostName}</span> : null}
        </div>
        <div className="forwarding-row-actions">
          <ForwardModeBadge compact mode={forward.mode} />
          <StatusBadge status={forward.status === 'running' ? 'connected' : 'connecting'} label={t(`forwards.status.${forward.status}`)} />
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
      <ForwardStateFeedback forward={forward} />
      <ForwardRuntimeMetrics forward={forward} now={now} />
    </article>
  )
}

function ForwardWorkspacePane({
  className,
  icon,
  title,
  hint,
  count,
  children,
}: {
  className: string
  icon: ReactNode
  title: string
  hint: string
  count: number
  children: ReactNode
}) {
  return (
    <section className={`forwarding-workspace-pane ${className}`}>
      <header className="forwarding-section-header">
        <span className="forwarding-section-icon" aria-hidden="true">{icon}</span>
        <div>
          <h2>{title}</h2>
          <p>{hint}</p>
        </div>
        <strong>{count}</strong>
      </header>
      <div className="forwarding-pane-content">{children}</div>
    </section>
  )
}

function OverviewMetric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <span className="forwarding-overview-metric">
      <span aria-hidden="true">{icon}</span>
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  )
}

function ForwardingEmpty({ description }: { description: string }) {
  return (
    <div className="forwarding-empty">
      <Empty description={description} image={Empty.PRESENTED_IMAGE_SIMPLE} />
    </div>
  )
}

function matchesMode(mode: ForwardMode, filter: ForwardModeFilter) {
  return filter === 'all' || mode === filter
}

function matchesForwardProfile(
  profile: ForwardProfile,
  host: AppData['hosts'][number] | undefined,
  search: string,
) {
  if (!search) {
    return true
  }
  return includesForwardSearch([
    profile.name,
    profile.description,
    host?.name,
    host?.username,
    host?.address,
    profile.bind_host,
    profile.bind_port,
    profile.target_host,
    profile.target_port,
  ], search)
}

function matchesForwardInstance(
  forward: ForwardInstance,
  host: AppData['hosts'][number] | undefined,
  search: string,
) {
  if (!search) {
    return true
  }
  return includesForwardSearch([
    forward.name,
    host?.name,
    host?.username,
    host?.address,
    forward.bind_host,
    forward.bind_port,
    forward.bound_address,
    forward.target_host,
    forward.target_port,
    forward.last_error,
  ], search)
}

function includesForwardSearch(values: Array<string | number | undefined>, search: string) {
  return values.some((value) => String(value ?? '').toLocaleLowerCase().includes(search))
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
