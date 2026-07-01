import { Activity, AlertTriangle, Ban, Copy, Database, ExternalLink, Globe2, LockKeyhole, Pencil, Plus, Power, RefreshCw, ServerCog, Shield, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react'
import { App as AntdApp, Button, Modal, Popconfirm, Select, Skeleton, Switch, Tooltip } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TermousApi } from '../../api/client'
import type { FirewallDesiredState, FirewallPersistenceStatus, FirewallProvider, FirewallProviderOption, FirewallRule, FirewallRuleInput, FirewallSnapshot, Host, Session } from '../../types/domain'
import { formatBytes } from '../files/fileUtils'
import { FirewallPersistencePanel } from './FirewallPersistencePanel'
import { FirewallRuleModal } from './FirewallRuleModal'
import {
  compactFirewallRuleInput,
  createFirewallRuleInput,
  firewallActionTone,
  firewallRuleToInput,
  formatFirewallPorts,
  formatFirewallSource,
  validateFirewallRuleInput,
} from './firewallUtils'

interface FirewallPanelProps {
  api: TermousApi
  session: Session | null
  host?: Host
  enabled: boolean
}

interface EditingState {
  index: number | null
  value: FirewallRuleInput
}

export function FirewallPanel({ api, session, host, enabled }: FirewallPanelProps) {
  const { t } = useTranslation()
  const { notification } = AntdApp.useApp()
  const [snapshot, setSnapshot] = useState<FirewallSnapshot | null>(null)
  const [providers, setProviders] = useState<FirewallProviderOption[]>([])
  const [selectedProvider, setSelectedProvider] = useState<FirewallProvider>('nftables')
  const [persistenceStatus, setPersistenceStatus] = useState<FirewallPersistenceStatus | null>(null)
  const [persistenceOpen, setPersistenceOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [applying, setApplying] = useState(false)
  const [editing, setEditing] = useState<EditingState | null>(null)

  const connectedLinux = Boolean(session?.kind === 'ssh' && session.status === 'connected' && host?.platform === 'linux')
  const rules = useMemo(() => snapshot?.rules.map(firewallRuleToInput) ?? [], [snapshot])
  const snapshotRuleById = useMemo(() => new Map((snapshot?.rules ?? []).map((rule) => [rule.id, rule])), [snapshot])
  const readonlyRules = useMemo(() => (snapshot?.unsupported_rules ?? []).filter(isCrossProviderReadonlyRule), [snapshot])

  const loadPersistenceStatus = useCallback(async (providerOverride?: FirewallProvider) => {
    if (!session?.id || !connectedLinux) {
      setPersistenceStatus(null)
      return
    }
    try {
      const nextStatus = await api.sessionFirewallPersistenceStatus(session.id, providerOverride ?? selectedProvider)
      setPersistenceStatus(nextStatus)
    } catch {
      setPersistenceStatus(null)
    }
  }, [api, connectedLinux, selectedProvider, session?.id])

  const load = useCallback(async (providerOverride?: FirewallProvider) => {
    if (!session?.id || !connectedLinux) {
      return
    }
    setLoading(true)
    setLoadError('')
    try {
      const providerList = await api.sessionFirewallProviders(session.id)
      setProviders(providerList.providers)
      const available = providerList.providers.filter((provider) => provider.provider !== 'unsupported')
      const requestedProvider = providerOverride ?? (snapshot ? selectedProvider : providerList.default_provider)
      const nextProvider = resolveFirewallProvider(requestedProvider, providerList.default_provider, available)
      setSelectedProvider(nextProvider)
      const capability = await api.sessionFirewallCapability(session.id, nextProvider)
      if (capability.status !== 'ready') {
        setSnapshot({
          session_id: session.id,
          capability,
          rules: [],
          unsupported_rules: [],
          snapshot_version: '',
          synced_at: new Date().toISOString(),
        })
        return
      }
      const nextSnapshot = await api.sessionFirewallSnapshot(session.id, nextProvider)
      setSnapshot(nextSnapshot)
      void loadPersistenceStatus(nextProvider)
    } catch (error) {
      const message = error instanceof Error ? error.message : t('app.error')
      setLoadError(message)
      notification.error({
        title: t('workbench.firewall.loadFailed'),
        description: message,
        duration: 5,
        role: 'alert',
        className: 'termous-notification',
      })
    } finally {
      setLoading(false)
    }
  }, [api, connectedLinux, loadPersistenceStatus, notification, selectedProvider, session?.id, snapshot, t])

  useEffect(() => {
    setSnapshot(null)
    setProviders([])
    setSelectedProvider('nftables')
    setPersistenceStatus(null)
    setPersistenceOpen(false)
    setEditing(null)
    setLoadError('')
  }, [session?.id])

  useEffect(() => {
    if (enabled && connectedLinux && !snapshot && !loading) {
      void load()
    }
  }, [connectedLinux, enabled, load, loading, snapshot])

  const desired = useCallback(
    (nextRules: FirewallRuleInput[], risk = false): FirewallDesiredState => ({
      snapshot_version: snapshot?.snapshot_version ?? '',
      rules: nextRules.map(compactFirewallRuleInput),
      confirm_risk: risk,
    }),
    [snapshot?.snapshot_version],
  )

  const applyRules = useCallback(
    async (nextRules: FirewallRuleInput[], confirmRisk = false, afterSuccess?: () => void) => {
      if (!session?.id) {
        return false
      }
      if (!confirmRisk && hasPotentialSSHBlock(nextRules)) {
        Modal.confirm({
          centered: true,
          className: 'termous-modal firewall-risk-confirm',
          title: t('workbench.firewall.confirmRiskRequired'),
          content: t('workbench.firewall.confirmRisk'),
          okText: t('app.confirm'),
          cancelText: t('app.cancel'),
          onOk: () => applyRules(nextRules, true, afterSuccess),
        })
        return false
      }
      setApplying(true)
      try {
        const result = await api.applySessionFirewall(session.id, desired(nextRules, confirmRisk), selectedProvider)
        setSnapshot(result.snapshot)
        notification.success({ title: result.message || t('workbench.firewall.applySuccess'), duration: 3, role: 'status', className: 'termous-notification' })
        afterSuccess?.()
        return true
      } catch (error) {
        notification.error({
          title: t('workbench.firewall.applyFailed'),
          description: error instanceof Error ? error.message : t('app.error'),
          duration: 5,
          role: 'alert',
          className: 'termous-notification',
        })
        return false
      } finally {
        setApplying(false)
      }
    },
    [api, desired, notification, selectedProvider, session?.id, t],
  )

  const saveEditing = async () => {
    if (!editing) {
      return
    }
    const error = validateFirewallRuleInput(editing.value, t)
    if (error) {
      notification.warning({ title: error, duration: 3, role: 'status', className: 'termous-notification' })
      return
    }
    const next = [...rules]
    if (editing.index === null) {
      next.push(compactFirewallRuleInput(editing.value))
    } else {
      next[editing.index] = compactFirewallRuleInput(editing.value)
    }
    await applyRules(next, false, () => setEditing(null))
  }

  if (!session || session.kind !== 'ssh') {
    return <FirewallEmpty title={t('workbench.firewall.emptyTitle')} description={t('workbench.firewall.emptyHint')} />
  }
  if (!connectedLinux) {
    return <FirewallEmpty title={t('workbench.firewall.unsupportedPlatform')} description={t('workbench.firewall.unsupportedPlatformHint')} />
  }
  if (loading && !snapshot) {
    return <FirewallLoading label={t('workbench.firewall.detecting')} />
  }
  if (loadError && !snapshot) {
    return <FirewallEmpty title={t('workbench.firewall.loadFailed')} description={loadError} />
  }
  if (!snapshot) {
    return <FirewallLoading label={t('workbench.firewall.detecting')} />
  }
  const providerOptions = providers.length ? providers.filter((provider) => provider.provider !== 'unsupported') : fallbackFirewallProviders()
  const currentProvider = providerOptions.find((provider) => provider.provider === selectedProvider)
  const capabilityReady = snapshot.capability.status === 'ready'

  return (
    <section className="firewall-panel">
      <div className="firewall-toolbar">
        <div>
          <span className="firewall-provider-pill">
            <Shield size={14} />
            {capabilityReady ? t('status.available') : t('status.failed')}
          </span>
          <small>{snapshot.synced_at ? t('workbench.firewall.syncedAt', { time: formatTime(snapshot.synced_at) }) : t('fields.none')}</small>
        </div>
        <div className="firewall-toolbar-actions">
          <div className="firewall-provider-picker">
            <span className="firewall-provider-picker-label">{t('workbench.firewall.providerSwitch')}</span>
            <Select
              className="termous-select firewall-provider-select"
              classNames={{ popup: { root: 'termous-select-popup firewall-provider-select-popup' } }}
              value={selectedProvider}
              options={providerOptions.map((provider) => ({
                value: provider.provider,
                label: (
                  <span className="firewall-provider-option">
                    <i className={firewallProviderStatusClass(provider)} />
                    {t(`workbench.firewall.provider.${provider.provider}`)}
                  </span>
                ),
              }))}
              onChange={(value) => {
                const nextProvider = value as FirewallProvider
                setSelectedProvider(nextProvider)
                setSnapshot(null)
                setPersistenceStatus(null)
                void load(nextProvider)
              }}
            />
          </div>
          <Tooltip title={t('workbench.firewall.refresh')}>
            <Button type="text" aria-label={t('workbench.firewall.refresh')} icon={<RefreshCw size={15} />} loading={loading} onClick={() => void load(selectedProvider)} />
          </Tooltip>
          <Tooltip title={snapshot.capability.supports_save ? t('workbench.firewall.persistence.open') : t('workbench.firewall.saveUnsupported')}>
            <Button
              className={`firewall-persistence-open ${persistenceStatusClass(persistenceStatus)}`}
              type="text"
              aria-label={t('workbench.firewall.persistence.open')}
              disabled={!snapshot.capability.supports_save}
              icon={<ServerCog size={15} />}
              onClick={() => setPersistenceOpen(true)}
            >
              {persistenceStatus ? t(`workbench.firewall.persistence.status.${persistenceStatus.status}`) : t('workbench.firewall.persistence.shortTitle')}
            </Button>
          </Tooltip>
        </div>
      </div>

      {!capabilityReady ? (
        <FirewallEmpty
          title={snapshot.capability.status === 'permission_denied' ? t('workbench.firewall.permissionDenied') : t('workbench.firewall.noProvider')}
          description={currentProvider?.message || snapshot.capability.message || t('workbench.firewall.noProviderHint')}
        />
      ) : null}

      {capabilityReady ? <div className="firewall-rule-actions">
        <Button className="secondary-button" icon={<Plus size={15} />} onClick={() => setEditing({ index: null, value: createFirewallRuleInput() })}>
          {t('workbench.firewall.addRule')}
        </Button>
      </div> : null}

      {capabilityReady && snapshot.warnings?.length ? (
        <div className="firewall-warning-list">
          {snapshot.warnings.map((warning) => (
            <span key={warning}><AlertTriangle size={13} />{warning}</span>
          ))}
        </div>
      ) : null}

      {capabilityReady ? <div className="firewall-rule-list">
        {rules.length === 0 ? (
          <div className="firewall-inline-empty">{t('workbench.firewall.noRules')}</div>
        ) : (
          rules.map((rule, index) => (
            <FirewallRuleCard
              key={rule.id || `${rule.protocol}-${rule.action}-${index}`}
              rule={rule}
              snapshotRule={rule.id ? snapshotRuleById.get(rule.id) : undefined}
              applying={applying}
              t={t}
              onEdit={() => setEditing({ index, value: rule })}
              onDuplicate={() => setEditing({ index: null, value: { ...rule, id: undefined, raw_ref: undefined, description: rule.description ? `${rule.description} ${t('workbench.firewall.copySuffix')}` : '' } })}
              onToggle={(checked) => void applyRules(rules.map((item, itemIndex) => (itemIndex === index ? { ...item, enabled: checked } : item)))}
              onDelete={() => void applyRules(rules.filter((_, itemIndex) => itemIndex !== index))}
            />
          ))
        )}
      </div> : null}

      {capabilityReady && readonlyRules.length > 0 ? (
        <div className="firewall-readonly-section">
          <div className="firewall-readonly-heading">
            <span>{t('workbench.firewall.crossProviderTitle')}</span>
            <small>{t('workbench.firewall.crossProviderHint')}</small>
          </div>
          <div className="firewall-readonly-list">
            {readonlyRules.map((rule) => (
              <FirewallReadonlyRuleCard
                key={rule.id}
                rule={rule}
                t={t}
                onSwitchProvider={(provider) => {
                  setSelectedProvider(provider)
                  setSnapshot(null)
                  void load(provider)
                }}
              />
            ))}
          </div>
        </div>
      ) : null}

      {editing ? (
        <FirewallRuleModal
          open
          title={editing.index === null ? t('workbench.firewall.editor.createTitle') : t('workbench.firewall.editor.editTitle')}
          value={editing.value}
          busy={applying}
          t={t}
          onChange={(value) => setEditing((current) => (current ? { ...current, value } : current))}
          onCancel={() => setEditing(null)}
          onSubmit={() => void saveEditing()}
        />
      ) : null}

      {session?.id ? (
        <FirewallPersistencePanel
          api={api}
          sessionId={session.id}
          provider={selectedProvider}
          open={persistenceOpen}
          t={t}
          onClose={() => setPersistenceOpen(false)}
          onSaved={() => {
            void load(selectedProvider)
          }}
        />
      ) : null}
    </section>
  )
}

function FirewallReadonlyRuleCard({
  rule,
  t,
  onSwitchProvider,
}: {
  rule: FirewallRule
  t: (key: string, params?: Record<string, unknown>) => string
  onSwitchProvider: (provider: FirewallProvider) => void
}) {
  const sourceProvider = rule.edit_provider ?? rule.source_provider ?? 'iptables'
  const ports = displayFirewallPorts(rule.protocol, rule.ports ?? [], t)
  const source = formatFirewallSource(rule.source)
  const actionIcon = rule.action === 'allow' ? <ShieldCheck size={15} /> : rule.action === 'reject' ? <ShieldAlert size={15} /> : <Ban size={15} />
  return (
    <article className={`firewall-rule-row firewall-readonly-rule ${firewallActionTone(rule.action)}`}>
      <span className="firewall-rule-accent" />
      <div className="firewall-rule-card-top">
        <span className="firewall-rule-symbol">{actionIcon}</span>
        <div className="firewall-rule-title">
          <strong>{t(`workbench.firewall.protocol.${rule.protocol}`)} · {ports}</strong>
          <Tooltip title={rule.description || t('workbench.firewall.noDescription')} placement="topLeft">
            <small>{rule.description || t('workbench.firewall.noDescription')}</small>
          </Tooltip>
        </div>
      </div>
      <div className="firewall-rule-meta firewall-readonly-meta">
        <span className="firewall-rule-action">{t(`workbench.firewall.action.${rule.action}`)}</span>
        <Tooltip title={source} placement="topLeft">
          <span className="firewall-rule-source-value"><Globe2 size={13} />{t('workbench.firewall.sourceLabel')} {source}</span>
        </Tooltip>
      </div>
      <div className="firewall-rule-switch firewall-readonly-provider-slot">
        <span className="firewall-rule-source-provider"><LockKeyhole size={12} />{t('workbench.firewall.managedByProvider', { provider: t(`workbench.firewall.provider.${sourceProvider}`) })}</span>
      </div>
      <div className="firewall-rule-card-actions firewall-readonly-actions">
        <Tooltip title={rule.readonly_reason || t('workbench.firewall.readonly')}>
          <Button type="text" className="firewall-readonly-switch" icon={<ExternalLink size={14} />} onClick={() => onSwitchProvider(sourceProvider)}>
            {t('workbench.firewall.switchProvider', { provider: t(`workbench.firewall.provider.${sourceProvider}`) })}
          </Button>
        </Tooltip>
      </div>
    </article>
  )
}

function FirewallRuleCard({
  rule,
  snapshotRule,
  applying,
  t,
  onEdit,
  onDuplicate,
  onToggle,
  onDelete,
}: {
  rule: FirewallRuleInput
  snapshotRule?: FirewallRule
  applying: boolean
  t: (key: string, params?: Record<string, unknown>) => string
  onEdit: () => void
  onDuplicate: () => void
  onToggle: (checked: boolean) => void
  onDelete: () => void
}) {
  const ports = displayFirewallPorts(rule.protocol, rule.ports, t)
  const source = formatFirewallSource(rule.source)
  const actionIcon = rule.action === 'allow' ? <ShieldCheck size={16} /> : rule.action === 'reject' ? <ShieldAlert size={16} /> : <Ban size={16} />
  const hasCounters = Boolean(snapshotRule?.counters_available)
  const localDisabled = Boolean(snapshotRule?.disabled_local)
  const editable = snapshotRule?.editable ?? true
  return (
    <article className={`firewall-rule-row ${firewallActionTone(rule.action)} ${rule.enabled ? '' : 'is-disabled'}`}>
      <span className="firewall-rule-accent" />
      <div className="firewall-rule-card-top">
        <span className="firewall-rule-symbol">{actionIcon}</span>
        <div className="firewall-rule-title">
          <strong>{t(`workbench.firewall.protocol.${rule.protocol}`)} · {ports}</strong>
          <Tooltip title={rule.description || t('workbench.firewall.noDescription')} placement="topLeft">
            <small>{rule.description || t('workbench.firewall.noDescription')}</small>
          </Tooltip>
        </div>
      </div>

      <div className="firewall-rule-meta">
        <span className="firewall-rule-action">{t(`workbench.firewall.action.${rule.action}`)}</span>
        <Tooltip title={source} placement="topLeft">
          <span><Globe2 size={13} />{t('workbench.firewall.sourceLabel')} {source}</span>
        </Tooltip>
        {localDisabled ? <span className="firewall-rule-local">{t('workbench.firewall.localDisabled')}</span> : null}
        {hasCounters ? <span><Activity size={13} />{t('workbench.firewall.hitCount', { count: snapshotRule?.hit_count ?? 0 })}</span> : null}
        {hasCounters ? <span><Database size={13} />{formatBytes(snapshotRule?.byte_count ?? 0)}</span> : null}
      </div>

      <div className="firewall-rule-switch">
        <span className={rule.enabled ? 'is-enabled' : 'is-muted'}>
          <Power size={13} />
          {rule.enabled ? t('workbench.firewall.enabledState') : t('workbench.firewall.disabledState')}
        </span>
        <Switch size="small" checked={rule.enabled} loading={applying} disabled={!editable || applying} onChange={onToggle} />
      </div>

      <div className="firewall-rule-card-actions">
        <Tooltip title={editable ? t('workbench.firewall.edit') : snapshotRule?.readonly_reason || t('workbench.firewall.readonly')}>
          <Button type="text" aria-label={t('workbench.firewall.edit')} disabled={!editable || applying} icon={<Pencil size={14} />} onClick={onEdit} />
        </Tooltip>
        <Tooltip title={t('workbench.firewall.duplicate')}>
          <Button type="text" aria-label={t('workbench.firewall.duplicate')} disabled={applying} icon={<Copy size={14} />} onClick={onDuplicate} />
        </Tooltip>
        <Popconfirm title={t('workbench.firewall.deleteConfirm')} okText={t('app.confirm')} cancelText={t('app.cancel')} onConfirm={onDelete}>
          <Button type="text" danger aria-label={t('workbench.firewall.delete')} disabled={!editable || applying} icon={<Trash2 size={14} />} />
        </Popconfirm>
      </div>
    </article>
  )
}

function FirewallEmpty({ title, description }: { title: string; description: string }) {
  return (
    <div className="firewall-empty">
      <ShieldAlert size={22} />
      <strong>{title}</strong>
      <small>{description}</small>
    </div>
  )
}

function FirewallLoading({ label }: { label: string }) {
  return (
    <div className="firewall-loading">
      <div className="firewall-loading-card">
        <span><ShieldAlert size={15} />{label}</span>
        <Skeleton active title={false} paragraph={{ rows: 4 }} />
      </div>
    </div>
  )
}

function displayFirewallPorts(protocol: FirewallRuleInput['protocol'], ports: FirewallRuleInput['ports'], t: (key: string) => string) {
  const value = formatFirewallPorts(protocol, ports)
  return value === 'Any' ? t('workbench.firewall.any') : value
}

function resolveFirewallProvider(current: FirewallProvider, fallback: FirewallProvider, providers: FirewallProviderOption[]) {
  if (providers.some((provider) => provider.provider === current)) {
    return current
  }
  if (fallback !== 'unsupported' && providers.some((provider) => provider.provider === fallback)) {
    return fallback
  }
  return providers[0]?.provider ?? 'nftables'
}

function fallbackFirewallProviders(): FirewallProviderOption[] {
  return [
    fallbackFirewallProvider('nftables'),
    fallbackFirewallProvider('iptables'),
  ]
}

function fallbackFirewallProvider(provider: FirewallProvider): FirewallProviderOption {
  return {
    provider,
    status: 'unsupported',
    present: false,
    privilege: 'none',
    supports_apply: false,
    supports_save: false,
    supports_counters: false,
    recommended: false,
  }
}

function isCrossProviderReadonlyRule(rule: FirewallRule) {
  return Boolean(rule.cross_provider && (rule.edit_provider || rule.source_provider))
}

function firewallProviderStatusClass(provider: FirewallProviderOption) {
  if (provider.status === 'ready') {
    return 'is-ready'
  }
  if (provider.status === 'permission_denied') {
    return 'is-denied'
  }
  return 'is-offline'
}

function persistenceStatusClass(status: FirewallPersistenceStatus | null) {
  if (!status) {
    return 'is-neutral'
  }
  if (status.status === 'service_enabled' || status.status === 'file_saved') {
    return 'is-ready'
  }
  if (status.status === 'missing_tools' || status.status === 'partial') {
    return 'is-warning'
  }
  if (status.status === 'permission_denied' || status.status === 'unsupported') {
    return 'is-error'
  }
  return 'is-neutral'
}

function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function hasPotentialSSHBlock(rules: FirewallRuleInput[]) {
  return rules.some((rule) => {
    if (!rule.enabled || (rule.action !== 'drop' && rule.action !== 'reject')) {
      return false
    }
    const openSource = !rule.source || rule.source === '0.0.0.0/0'
    if (!openSource || (rule.protocol !== 'any' && rule.protocol !== 'tcp')) {
      return false
    }
    if (rule.protocol === 'any' && rule.ports.length === 0) {
      return true
    }
    return rule.ports.some((port) => port.from <= 22 && port.to >= 22)
  })
}
