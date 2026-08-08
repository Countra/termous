import { Activity, AlertTriangle, Ban, Copy, Database, ExternalLink, Globe2, LockKeyhole, Pencil, Plus, Power, RefreshCw, Save, Shield, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react'
import { App as AntdApp, Button, Modal, Popconfirm, Select, Switch, Tooltip } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TermousApiError } from '#shared/api'
import { formatBytes } from '#shared/format'
import { uiStyles, WorkspaceDetectionLoading, WorkspaceEmptyState } from '#shared/ui'
import type {
  FirewallDesiredState,
  FirewallPersistenceStatus,
  FirewallProvider,
  FirewallProviderOption,
  FirewallRule,
  FirewallRuleInput,
  FirewallSnapshot,
} from '#entities/firewall'
import type { FirewallGateway, FirewallHostContext, FirewallSessionContext } from '../model/contracts'
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
} from '../model/firewallUtils'
import styles from './FirewallPanel.module.scss'

export interface FirewallPanelProps {
  api: FirewallGateway
  session: FirewallSessionContext | null
  host?: FirewallHostContext
  enabled: boolean
}

interface EditingState {
  index: number | null
  value: FirewallRuleInput
}

interface LoadRequest {
  controller: AbortController
  sequence: number
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
  const [deleteConfirmKey, setDeleteConfirmKey] = useState<string | null>(null)
  const loadAbortRef = useRef<AbortController | null>(null)
  const loadSequenceRef = useRef(0)
  const applyAbortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(false)
  const sessionStateRef = useRef({ id: session?.id, connectedLinux: false })
  const selectedProviderRef = useRef(selectedProvider)
  const enabledRef = useRef(enabled)
  const riskConfirmRef = useRef<ReturnType<typeof Modal.confirm> | null>(null)

  const connectedLinux = Boolean(session?.kind === 'ssh' && session.status === 'connected' && host?.platform === 'linux')
  const linuxSessionUnavailable = Boolean(
    session?.kind === 'ssh' &&
    host?.platform === 'linux' &&
    (session.status === 'disconnected' || session.status === 'failed'),
  )
  const rules = useMemo(() => (snapshot?.rules ?? []).map(firewallRuleToInput), [snapshot])
  const snapshotRuleById = useMemo(() => new Map((snapshot?.rules ?? []).map((rule) => [rule.id, rule])), [snapshot])
  const readonlyRules = useMemo(() => (snapshot?.unsupported_rules ?? []).filter(isCrossProviderReadonlyRule), [snapshot])

  sessionStateRef.current = { id: session?.id, connectedLinux }
  selectedProviderRef.current = selectedProvider
  enabledRef.current = enabled

  const destroyRiskConfirm = useCallback(() => {
    riskConfirmRef.current?.destroy()
    riskConfirmRef.current = null
  }, [])

  const abortLoad = useCallback(() => {
    loadSequenceRef.current += 1
    loadAbortRef.current?.abort()
    loadAbortRef.current = null
  }, [])

  const beginLoad = useCallback(() => {
    abortLoad()
    const controller = new AbortController()
    loadAbortRef.current = controller
    return { controller, sequence: loadSequenceRef.current }
  }, [abortLoad])

  const isLoadOwner = useCallback((request: LoadRequest) => {
    return mountedRef.current && loadAbortRef.current === request.controller && loadSequenceRef.current === request.sequence
  }, [])

  const isActiveLoad = useCallback((request: LoadRequest, sessionId: string) => {
    const state = sessionStateRef.current
    return isLoadOwner(request) && !request.controller.signal.aborted && state.id === sessionId && state.connectedLinux
  }, [isLoadOwner])

  const finishLoad = useCallback((request: LoadRequest) => {
    if (loadAbortRef.current === request.controller && loadSequenceRef.current === request.sequence) {
      loadAbortRef.current = null
    }
  }, [])

  const abortApply = useCallback(() => {
    applyAbortRef.current?.abort()
    applyAbortRef.current = null
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortLoad()
      abortApply()
      destroyRiskConfirm()
    }
  }, [abortApply, abortLoad, destroyRiskConfirm])

  const load = useCallback(async (providerOverride?: FirewallProvider) => {
    const targetSessionId = session?.id
    if (!targetSessionId || !connectedLinux) {
      return
    }
    const request = beginLoad()
    setLoading(true)
    setLoadError('')
    try {
      const providerList = await api.sessionFirewallProviders(targetSessionId, { signal: request.controller.signal })
      if (!isActiveLoad(request, targetSessionId)) {
        return
      }
      setProviders(providerList.providers)
      const available = providerList.providers.filter((provider) => provider.provider !== 'unsupported')
      const requestedProvider = providerOverride ?? (snapshot ? selectedProvider : providerList.default_provider)
      const nextProvider = resolveFirewallProvider(requestedProvider, providerList.default_provider, available)
      setSelectedProvider(nextProvider)
      const capability = await api.sessionFirewallCapability(targetSessionId, nextProvider, { signal: request.controller.signal })
      if (!isActiveLoad(request, targetSessionId)) {
        return
      }
      if (capability.status !== 'ready') {
        setPersistenceStatus(null)
        setSnapshot({
          session_id: targetSessionId,
          capability,
          rules: [],
          unsupported_rules: [],
          snapshot_version: '',
          synced_at: new Date().toISOString(),
        })
        return
      }
      const nextSnapshot = await api.sessionFirewallSnapshot(targetSessionId, nextProvider, { signal: request.controller.signal })
      if (!isActiveLoad(request, targetSessionId)) {
        return
      }
      setSnapshot(nextSnapshot)
      try {
        const nextStatus = await api.sessionFirewallPersistenceStatus(targetSessionId, nextProvider, { signal: request.controller.signal })
        if (isActiveLoad(request, targetSessionId)) {
          setPersistenceStatus(nextStatus)
        }
      } catch (error) {
        if (!isRequestAbort(error) && isActiveLoad(request, targetSessionId)) {
          setPersistenceStatus(null)
        }
      }
    } catch (error) {
      if (isRequestAbort(error) || !isActiveLoad(request, targetSessionId)) {
        return
      }
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
      if (isLoadOwner(request)) {
        setLoading(false)
      }
      finishLoad(request)
    }
  }, [api, beginLoad, connectedLinux, finishLoad, isActiveLoad, isLoadOwner, notification, selectedProvider, session?.id, snapshot, t])

  useEffect(() => {
    abortLoad()
    abortApply()
    setSnapshot(null)
    setProviders([])
    setSelectedProvider('nftables')
    setPersistenceStatus(null)
    setPersistenceOpen(false)
    setEditing(null)
    setDeleteConfirmKey(null)
    destroyRiskConfirm()
    setLoadError('')
    setLoading(false)
    setApplying(false)
  }, [abortApply, abortLoad, destroyRiskConfirm, session?.id])

  useEffect(() => {
    if (enabled && connectedLinux && !snapshot && !loading && !loadError) {
      void load()
    }
  }, [connectedLinux, enabled, load, loadError, loading, snapshot])

  useEffect(() => {
    if (!linuxSessionUnavailable) {
      return
    }
    setLoading(false)
    setApplying(false)
    setPersistenceOpen(false)
    setDeleteConfirmKey(null)
    destroyRiskConfirm()
    abortLoad()
    abortApply()
  }, [abortApply, abortLoad, destroyRiskConfirm, linuxSessionUnavailable])

  useEffect(() => {
    if (!enabled) {
      abortLoad()
      setPersistenceOpen(false)
      setEditing(null)
      setDeleteConfirmKey(null)
      destroyRiskConfirm()
      setLoading(false)
      return
    }
    if (!connectedLinux) {
      abortLoad()
      abortApply()
      setLoading(false)
      setApplying(false)
    }
  }, [abortApply, abortLoad, connectedLinux, destroyRiskConfirm, enabled])

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
      const targetSessionId = session?.id
      const targetProvider = selectedProvider
      if (!enabledRef.current || !targetSessionId || !isCurrentSessionProviderConnected(sessionStateRef.current, selectedProviderRef.current, targetSessionId, targetProvider)) {
        return false
      }
      setDeleteConfirmKey(null)
      if (!confirmRisk && hasPotentialSSHBlock(nextRules)) {
        destroyRiskConfirm()
        const confirmation = Modal.confirm({
          centered: true,
          className: 'termous-modal',
          title: t('workbench.firewall.confirmRiskRequired'),
          content: t('workbench.firewall.confirmRisk'),
          okText: t('app.confirm'),
          cancelText: t('app.cancel'),
          onOk: () => applyRules(nextRules, true, afterSuccess),
          onCancel: () => {
            if (riskConfirmRef.current === confirmation) {
              riskConfirmRef.current = null
            }
          },
          afterClose: () => {
            if (riskConfirmRef.current === confirmation) {
              riskConfirmRef.current = null
            }
          },
        })
        riskConfirmRef.current = confirmation
        return false
      }
      abortApply()
      const controller = new AbortController()
      applyAbortRef.current = controller
      setApplying(true)
      try {
        const result = await api.applySessionFirewall(targetSessionId, desired(nextRules, confirmRisk), targetProvider, { signal: controller.signal })
        if (controller.signal.aborted || applyAbortRef.current !== controller || !isCurrentSessionProviderConnected(sessionStateRef.current, selectedProviderRef.current, targetSessionId, targetProvider)) {
          return false
        }
        setSnapshot(result.snapshot)
        notification.success({ title: result.message || t('workbench.firewall.applySuccess'), duration: 3, role: 'status', className: 'termous-notification' })
        afterSuccess?.()
        return true
      } catch (error) {
        if (isRequestAbort(error) || controller.signal.aborted || applyAbortRef.current !== controller || !isCurrentSessionProviderConnected(sessionStateRef.current, selectedProviderRef.current, targetSessionId, targetProvider)) {
          return false
        }
        notification.error({
          title: t('workbench.firewall.applyFailed'),
          description: error instanceof Error ? error.message : t('app.error'),
          duration: 5,
          role: 'alert',
          className: 'termous-notification',
        })
        return false
      } finally {
        if (applyAbortRef.current === controller) {
          applyAbortRef.current = null
          setApplying(false)
        }
      }
    },
    [abortApply, api, desired, destroyRiskConfirm, notification, selectedProvider, session?.id, t],
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
  if (linuxSessionUnavailable) {
    return <FirewallEmpty title={t('workbench.firewall.sessionUnavailable')} description={t('workbench.firewall.sessionUnavailableHint')} />
  }
  if (!connectedLinux) {
    return <FirewallEmpty title={t('workbench.firewall.unsupportedPlatform')} description={t('workbench.firewall.unsupportedPlatformHint')} />
  }
  if (loading && !snapshot) {
    return <WorkspaceDetectionLoading icon={<ShieldAlert size={15} />} label={t('workbench.firewall.detecting')} />
  }
  if (loadError && !snapshot) {
    return <FirewallEmpty title={t('workbench.firewall.loadFailed')} description={loadError} />
  }
  if (!snapshot) {
    return <WorkspaceDetectionLoading icon={<ShieldAlert size={15} />} label={t('workbench.firewall.detecting')} />
  }
  const providerOptions = providers.length ? providers.filter((provider) => provider.provider !== 'unsupported') : fallbackFirewallProviders()
  const currentProvider = providerOptions.find((provider) => provider.provider === selectedProvider)
  const capabilityReady = snapshot.capability.status === 'ready'

  return (
    <section className={[styles['firewall-panel'], styles.root].join(' ')}>
      <div className={styles['firewall-toolbar']}>
        <div className={styles['firewall-toolbar-summary']}>
          <div className={[
            styles['firewall-toolbar-state'],
            styles[capabilityReady ? 'is-ready' : 'is-error'],
          ].join(' ')}>
            <span className={styles['firewall-toolbar-state-icon']}>
              <Shield size={15} />
            </span>
            <span className={styles['firewall-toolbar-state-copy']}>
              <strong>{capabilityReady ? t('status.available') : t('status.failed')}</strong>
              <small>
                {t('workbench.firewall.syncedAtLabel')}
                <time>{snapshot.synced_at ? formatTime(snapshot.synced_at) : t('fields.none')}</time>
              </small>
            </span>
          </div>
          <Tooltip title={t('workbench.firewall.refresh')}>
            <Button className={styles['firewall-toolbar-icon-button']} type="text" aria-label={t('workbench.firewall.refresh')} icon={<RefreshCw size={15} />} loading={loading} onClick={() => void load(selectedProvider)} />
          </Tooltip>
        </div>
        <div className={styles['firewall-toolbar-controls']}>
          <div className={styles['firewall-provider-picker']}>
            <span className={styles['firewall-provider-picker-label']}>{t('workbench.firewall.providerSwitch')}</span>
            <Select
              className={`termous-select ${styles['firewall-provider-select']}`}
              classNames={{ popup: { root: 'termous-select-popup' } }}
              value={selectedProvider}
              options={providerOptions.map((provider) => ({
                value: provider.provider,
                label: (
                  <span className={styles['firewall-provider-option']}>
                    <i className={styles[firewallProviderStatusClass(provider)]} />
                    {t(`workbench.firewall.provider.${provider.provider}`)}
                  </span>
                ),
              }))}
              onChange={(value) => {
                const nextProvider = value as FirewallProvider
                destroyRiskConfirm()
                setDeleteConfirmKey(null)
                abortApply()
                setApplying(false)
                setSelectedProvider(nextProvider)
                setSnapshot(null)
                setPersistenceStatus(null)
                void load(nextProvider)
              }}
            />
          </div>
          <Tooltip title={snapshot.capability.supports_save ? t('workbench.firewall.persistence.open') : t('workbench.firewall.saveUnsupported')}>
            <Button
              className={[
                styles['firewall-persistence-open'],
                styles[persistenceStatusClass(persistenceStatus)] ?? '',
              ].filter(Boolean).join(' ')}
              type="text"
              aria-label={t('workbench.firewall.persistence.open')}
              disabled={!snapshot.capability.supports_save}
              icon={<Save size={15} />}
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

      {capabilityReady ? <div className={styles['firewall-rule-actions']}>
        <Button className={`${uiStyles['secondary-button']} secondary-button`} icon={<Plus size={15} />} onClick={() => setEditing({ index: null, value: createFirewallRuleInput() })}>
          {t('workbench.firewall.addRule')}
        </Button>
      </div> : null}

      {capabilityReady && snapshot.warnings?.length ? (
        <div className={styles['firewall-warning-list']}>
          {snapshot.warnings.map((warning) => (
            <span key={warning}><AlertTriangle size={13} />{warning}</span>
          ))}
        </div>
      ) : null}

      {capabilityReady ? <div className={styles['firewall-rule-list']}>
        {rules.length === 0 ? (
          <div className={styles['firewall-inline-empty']}>{t('workbench.firewall.noRules')}</div>
        ) : (
          rules.map((rule, index) => {
            const ruleKey = rule.id || `${rule.protocol}-${rule.action}-${index}`
            return <FirewallRuleCard
              key={ruleKey}
              rule={rule}
              snapshotRule={rule.id ? snapshotRuleById.get(rule.id) : undefined}
              applying={applying}
              t={t}
              deleteConfirmOpen={deleteConfirmKey === ruleKey}
              onDeleteOpenChange={(open) => setDeleteConfirmKey((current) => (open ? ruleKey : current === ruleKey ? null : current))}
              onEdit={() => {
                setDeleteConfirmKey(null)
                setEditing({ index, value: rule })
              }}
              onDuplicate={() => {
                setDeleteConfirmKey(null)
                setEditing({ index: null, value: { ...rule, id: undefined, raw_ref: undefined, description: rule.description ? `${rule.description} ${t('workbench.firewall.copySuffix')}` : '' } })
              }}
              onToggle={(checked) => void applyRules(rules.map((item, itemIndex) => (itemIndex === index ? { ...item, enabled: checked } : item)))}
              onDelete={() => {
                setDeleteConfirmKey(null)
                void applyRules(rules.filter((_, itemIndex) => itemIndex !== index))
              }}
            />
          })
        )}
      </div> : null}

      {capabilityReady && readonlyRules.length > 0 ? (
        <div className={styles['firewall-readonly-section']}>
          <div className={styles['firewall-readonly-heading']}>
            <span>{t('workbench.firewall.crossProviderTitle')}</span>
            <small>{t('workbench.firewall.crossProviderHint')}</small>
          </div>
          <div className={styles['firewall-readonly-list']}>
            {readonlyRules.map((rule) => (
              <FirewallReadonlyRuleCard
                key={rule.id}
                rule={rule}
                t={t}
                onSwitchProvider={(provider) => {
                  destroyRiskConfirm()
                  setDeleteConfirmKey(null)
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
          sessionStatus={session.status}
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
    <article className={[
      styles['firewall-rule-row'],
      styles['firewall-readonly-rule'],
      styles[firewallActionTone(rule.action)] ?? '',
    ].filter(Boolean).join(' ')}>
      <span className={styles['firewall-rule-accent']} />
      <div className={styles['firewall-rule-card-top']}>
        <span className={styles['firewall-rule-symbol']}>{actionIcon}</span>
        <div className={styles['firewall-rule-title']}>
          <strong>{t(`workbench.firewall.protocol.${rule.protocol}`)} · {ports}</strong>
          <Tooltip title={rule.description || t('workbench.firewall.noDescription')} placement="topLeft">
            <small>{rule.description || t('workbench.firewall.noDescription')}</small>
          </Tooltip>
        </div>
      </div>
      <div className={[styles['firewall-rule-meta'], styles['firewall-readonly-meta']].join(' ')}>
        <span className={styles['firewall-rule-action']}>{t(`workbench.firewall.action.${rule.action}`)}</span>
        <Tooltip title={source} placement="topLeft">
          <span className={styles['firewall-rule-source-value']}><Globe2 size={13} />{t('workbench.firewall.sourceLabel')} {source}</span>
        </Tooltip>
      </div>
      <div className={[styles['firewall-rule-switch'], styles['firewall-readonly-provider-slot']].join(' ')}>
        <span className={styles['firewall-rule-source-provider']}><LockKeyhole size={12} />{t('workbench.firewall.managedByProvider', { provider: t(`workbench.firewall.provider.${sourceProvider}`) })}</span>
      </div>
      <div className={[styles['firewall-rule-card-actions'], styles['firewall-readonly-actions']].join(' ')}>
        <Tooltip title={rule.readonly_reason || t('workbench.firewall.readonly')}>
          <Button type="text" className={styles['firewall-readonly-switch']} icon={<ExternalLink size={14} />} onClick={() => onSwitchProvider(sourceProvider)}>
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
  deleteConfirmOpen,
  onDeleteOpenChange,
}: {
  rule: FirewallRuleInput
  snapshotRule?: FirewallRule
  applying: boolean
  t: (key: string, params?: Record<string, unknown>) => string
  onEdit: () => void
  onDuplicate: () => void
  onToggle: (checked: boolean) => void
  onDelete: () => void
  deleteConfirmOpen: boolean
  onDeleteOpenChange: (open: boolean) => void
}) {
  const ports = displayFirewallPorts(rule.protocol, rule.ports, t)
  const source = formatFirewallSource(rule.source)
  const actionIcon = rule.action === 'allow' ? <ShieldCheck size={16} /> : rule.action === 'reject' ? <ShieldAlert size={16} /> : <Ban size={16} />
  const hasCounters = Boolean(snapshotRule?.counters_available)
  const localDisabled = Boolean(snapshotRule?.disabled_local)
  const editable = snapshotRule?.editable ?? true
  return (
    <article className={[
      styles['firewall-rule-row'],
      styles[firewallActionTone(rule.action)] ?? '',
      rule.enabled ? '' : styles['is-disabled'],
    ].filter(Boolean).join(' ')}>
      <span className={styles['firewall-rule-accent']} />
      <div className={styles['firewall-rule-card-top']}>
        <span className={styles['firewall-rule-symbol']}>{actionIcon}</span>
        <div className={styles['firewall-rule-title']}>
          <strong>{t(`workbench.firewall.protocol.${rule.protocol}`)} · {ports}</strong>
          <Tooltip title={rule.description || t('workbench.firewall.noDescription')} placement="topLeft">
            <small>{rule.description || t('workbench.firewall.noDescription')}</small>
          </Tooltip>
        </div>
      </div>

      <div className={styles['firewall-rule-meta']}>
        <span className={styles['firewall-rule-action']}>{t(`workbench.firewall.action.${rule.action}`)}</span>
        <Tooltip title={source} placement="topLeft">
          <span><Globe2 size={13} />{t('workbench.firewall.sourceLabel')} {source}</span>
        </Tooltip>
        {localDisabled ? <span className={styles['firewall-rule-local']}>{t('workbench.firewall.localDisabled')}</span> : null}
        {hasCounters ? <span><Activity size={13} />{t('workbench.firewall.hitCount', { count: snapshotRule?.hit_count ?? 0 })}</span> : null}
        {hasCounters ? <span><Database size={13} />{formatBytes(snapshotRule?.byte_count ?? 0)}</span> : null}
      </div>

      <div className={styles['firewall-rule-switch']}>
        <span className={styles[rule.enabled ? 'is-enabled' : 'is-muted']}>
          <Power size={13} />
          {rule.enabled ? t('workbench.firewall.enabledState') : t('workbench.firewall.disabledState')}
        </span>
        <Switch size="small" checked={rule.enabled} loading={applying} disabled={!editable || applying} onChange={onToggle} />
      </div>

      <div className={styles['firewall-rule-card-actions']}>
        <Tooltip title={editable ? t('workbench.firewall.edit') : snapshotRule?.readonly_reason || t('workbench.firewall.readonly')}>
          <Button type="text" aria-label={t('workbench.firewall.edit')} disabled={!editable || applying} icon={<Pencil size={14} />} onClick={onEdit} />
        </Tooltip>
        <Tooltip title={t('workbench.firewall.duplicate')}>
          <Button type="text" aria-label={t('workbench.firewall.duplicate')} disabled={applying} icon={<Copy size={14} />} onClick={onDuplicate} />
        </Tooltip>
        <Popconfirm
          open={deleteConfirmOpen}
          title={t('workbench.firewall.deleteConfirm')}
          okText={t('app.confirm')}
          cancelText={t('app.cancel')}
          onOpenChange={onDeleteOpenChange}
          onConfirm={onDelete}
        >
          <Button type="text" danger aria-label={t('workbench.firewall.delete')} disabled={!editable || applying} icon={<Trash2 size={14} />} />
        </Popconfirm>
      </div>
    </article>
  )
}

function FirewallEmpty({ title, description }: { title: string; description: string }) {
  return (
    <WorkspaceEmptyState
      tone="warning"
      icon={<ShieldAlert size={22} />}
      title={title}
      description={description}
    />
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

function isRequestAbort(error: unknown) {
  return error instanceof TermousApiError && error.code === 'REQUEST_ABORTED'
}

function isCurrentSessionProviderConnected(
  state: { id?: string; connectedLinux: boolean },
  currentProvider: FirewallProvider,
  sessionId: string,
  provider: FirewallProvider,
) {
  return state.id === sessionId && state.connectedLinux && currentProvider === provider
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
