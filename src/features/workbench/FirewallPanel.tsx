import { AlertTriangle, Copy, Pencil, Plus, RefreshCw, Save, Shield, ShieldAlert, Trash2 } from 'lucide-react'
import { App as AntdApp, Button, Checkbox, Modal, Popconfirm, Skeleton, Tooltip } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TermousApi } from '../../api/client'
import type { FirewallDesiredState, FirewallPlan, FirewallRule, FirewallRuleInput, FirewallSnapshot, Host, Session } from '../../types/domain'
import { formatBytes } from '../files/fileUtils'
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
  const [draft, setDraft] = useState<FirewallRuleInput[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [applying, setApplying] = useState(false)
  const [editing, setEditing] = useState<EditingState | null>(null)
  const [plan, setPlan] = useState<FirewallPlan | null>(null)
  const [confirmRisk, setConfirmRisk] = useState(false)
  const [showUnsupported, setShowUnsupported] = useState(false)

  const connectedLinux = Boolean(session?.kind === 'ssh' && session.status === 'connected' && host?.platform === 'linux')
  const unsupportedRules = snapshot?.unsupported_rules ?? []
  const visibleUnsupportedRules = showUnsupported ? unsupportedRules : unsupportedRules.slice(0, 4)
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(snapshot?.rules.map(firewallRuleToInput) ?? []), [draft, snapshot])
  const snapshotRuleById = useMemo(() => new Map((snapshot?.rules ?? []).map((rule) => [rule.id, rule])), [snapshot])

  const load = useCallback(async () => {
    if (!session?.id || !connectedLinux) {
      return
    }
    setLoading(true)
    setLoadError('')
    try {
      const capability = await api.sessionFirewallCapability(session.id)
      if (capability.status !== 'ready') {
        setSnapshot({
          session_id: session.id,
          capability,
          rules: [],
          unsupported_rules: [],
          snapshot_version: '',
          synced_at: new Date().toISOString(),
        })
        setDraft([])
        return
      }
      const nextSnapshot = await api.sessionFirewallSnapshot(session.id)
      setSnapshot(nextSnapshot)
      setDraft(nextSnapshot.rules.map(firewallRuleToInput))
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
  }, [api, connectedLinux, notification, session?.id, t])

  useEffect(() => {
    setSnapshot(null)
    setDraft([])
    setPlan(null)
    setEditing(null)
    setLoadError('')
  }, [session?.id])

  useEffect(() => {
    if (enabled && connectedLinux && !snapshot && !loading) {
      void load()
    }
  }, [connectedLinux, enabled, load, loading, snapshot])

  const desired = useCallback(
    (risk = false): FirewallDesiredState => ({
      snapshot_version: snapshot?.snapshot_version ?? '',
      rules: draft.map(compactFirewallRuleInput),
      confirm_risk: risk,
    }),
    [draft, snapshot?.snapshot_version],
  )

  const saveEditing = () => {
    if (!editing) {
      return
    }
    const error = validateFirewallRuleInput(editing.value, t)
    if (error) {
      notification.warning({ title: error, duration: 3, role: 'status', className: 'termous-notification' })
      return
    }
    setDraft((current) => {
      const next = [...current]
      if (editing.index === null) {
        next.push(compactFirewallRuleInput(editing.value))
      } else {
        next[editing.index] = compactFirewallRuleInput(editing.value)
      }
      return next
    })
    setEditing(null)
  }

  const preview = async () => {
    if (!session?.id) {
      return
    }
    try {
      const nextPlan = await api.previewSessionFirewall(session.id, desired(false))
      setPlan(nextPlan)
      setConfirmRisk(nextPlan.risk_warnings?.length ? false : true)
    } catch (error) {
      notification.error({
        title: t('workbench.firewall.previewFailed'),
        description: error instanceof Error ? error.message : t('app.error'),
        duration: 5,
        role: 'alert',
        className: 'termous-notification',
      })
    }
  }

  const apply = async () => {
    if (!session?.id || !plan) {
      return
    }
    if (plan.risk_warnings?.length && !confirmRisk) {
      notification.warning({ title: t('workbench.firewall.confirmRiskRequired'), duration: 3, role: 'status', className: 'termous-notification' })
      return
    }
    setApplying(true)
    try {
      const result = await api.applySessionFirewall(session.id, desired(confirmRisk))
      setSnapshot(result.snapshot)
      setDraft(result.snapshot.rules.map(firewallRuleToInput))
      setPlan(null)
      notification.success({ title: result.message || t('workbench.firewall.applySuccess'), duration: 3, role: 'status', className: 'termous-notification' })
    } catch (error) {
      notification.error({
        title: t('workbench.firewall.applyFailed'),
        description: error instanceof Error ? error.message : t('app.error'),
        duration: 5,
        role: 'alert',
        className: 'termous-notification',
      })
    } finally {
      setApplying(false)
    }
  }

  const saveRemote = async () => {
    if (!session?.id) {
      return
    }
    setSaving(true)
    try {
      const result = await api.saveSessionFirewall(session.id)
      if (result.saved) {
        notification.success({ title: result.message, duration: 4, role: 'status', className: 'termous-notification' })
      } else {
        notification.info({ title: result.message, duration: 4, role: 'status', className: 'termous-notification' })
      }
    } catch (error) {
      notification.error({
        title: t('workbench.firewall.saveFailed'),
        description: error instanceof Error ? error.message : t('app.error'),
        duration: 5,
        role: 'alert',
        className: 'termous-notification',
      })
    } finally {
      setSaving(false)
    }
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
  if (snapshot?.capability.status !== 'ready') {
    return (
      <FirewallEmpty
        title={snapshot?.capability.status === 'permission_denied' ? t('workbench.firewall.permissionDenied') : t('workbench.firewall.noProvider')}
        description={snapshot?.capability.message || t('workbench.firewall.noProviderHint')}
      />
    )
  }

  return (
    <section className="firewall-panel">
      <div className="firewall-toolbar">
        <div>
          <span className="firewall-provider-pill">
            <Shield size={14} />
            {t(`workbench.firewall.provider.${snapshot.capability.provider}`)}
          </span>
          <small>{snapshot.synced_at ? t('workbench.firewall.syncedAt', { time: formatTime(snapshot.synced_at) }) : t('fields.none')}</small>
        </div>
        <div className="firewall-toolbar-actions">
          <Tooltip title={t('workbench.firewall.refresh')}>
            <Button type="text" aria-label={t('workbench.firewall.refresh')} icon={<RefreshCw size={15} />} loading={loading} onClick={() => void load()} />
          </Tooltip>
          <Tooltip title={snapshot.capability.supports_save ? t('workbench.firewall.saveRemote') : t('workbench.firewall.saveUnsupported')}>
            <Button type="text" aria-label={t('workbench.firewall.saveRemote')} disabled={!snapshot.capability.supports_save} loading={saving} icon={<Save size={15} />} onClick={() => void saveRemote()} />
          </Tooltip>
        </div>
      </div>

      <div className="firewall-rule-actions">
        <Button className="secondary-button" icon={<Plus size={15} />} onClick={() => setEditing({ index: null, value: createFirewallRuleInput() })}>
          {t('workbench.firewall.addRule')}
        </Button>
        <Button type="primary" disabled={!dirty || loading || applying} onClick={() => void preview()}>
          {t('workbench.firewall.previewApply')}
        </Button>
      </div>

      {snapshot.warnings?.length ? (
        <div className="firewall-warning-list">
          {snapshot.warnings.map((warning) => (
            <span key={warning}><AlertTriangle size={13} />{warning}</span>
          ))}
        </div>
      ) : null}

      <div className="firewall-rule-list">
        {draft.length === 0 ? (
          <div className="firewall-inline-empty">{t('workbench.firewall.noRules')}</div>
        ) : (
          draft.map((rule, index) => (
            <FirewallRuleCard
              key={rule.id || `${rule.protocol}-${rule.action}-${index}`}
              rule={rule}
              snapshotRule={rule.id ? snapshotRuleById.get(rule.id) : undefined}
              t={t}
              onEdit={() => setEditing({ index, value: rule })}
              onDuplicate={() => setDraft((current) => [...current, { ...rule, id: undefined, raw_ref: undefined, description: rule.description ? `${rule.description} ${t('workbench.firewall.copySuffix')}` : '' }])}
              onDelete={() => setDraft((current) => current.filter((_, itemIndex) => itemIndex !== index))}
            />
          ))
        )}
      </div>

      {unsupportedRules.length > 0 ? (
        <div className="firewall-unsupported">
          <div className="firewall-unsupported-head">
            <strong>{t('workbench.firewall.unsupportedRules')}</strong>
            <Button type="text" size="small" onClick={() => setShowUnsupported((current) => !current)}>
              {showUnsupported ? t('workbench.firewall.collapseUnsupported') : t('workbench.firewall.expandUnsupported', { count: unsupportedRules.length })}
            </Button>
          </div>
          {visibleUnsupportedRules.map((rule) => (
            <div key={rule.id}>
              <span>{rule.chain || rule.id}</span>
              <small>{rule.readonly_reason || t('workbench.firewall.unsupportedRuleHint')}</small>
            </div>
          ))}
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
          onSubmit={saveEditing}
        />
      ) : null}

      <Modal
        open={Boolean(plan)}
        centered
        className="termous-modal firewall-preview-modal"
        title={t('workbench.firewall.previewTitle')}
        okText={t('workbench.firewall.apply')}
        cancelText={t('app.cancel')}
        confirmLoading={applying}
        onCancel={() => setPlan(null)}
        onOk={() => void apply()}
      >
        <div className="firewall-preview">
          {plan?.changes.length === 0 ? (
            <div className="firewall-inline-empty">{t('workbench.firewall.noChanges')}</div>
          ) : (
            plan?.changes.map((change) => <FirewallPlanChangeRow key={`${change.type}-${change.rule_id}`} change={change} t={t} />)
          )}
          {plan?.risk_warnings?.length ? (
            <div className="firewall-risk-box">
              {plan.risk_warnings.map((warning) => (
                <span key={warning}><AlertTriangle size={14} />{warning}</span>
              ))}
              <Checkbox checked={confirmRisk} onChange={(event) => setConfirmRisk(event.target.checked)}>
                {t('workbench.firewall.confirmRisk')}
              </Checkbox>
            </div>
          ) : null}
        </div>
      </Modal>
    </section>
  )
}

function FirewallRuleCard({
  rule,
  snapshotRule,
  t,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  rule: FirewallRuleInput
  snapshotRule?: FirewallRule
  t: (key: string, params?: Record<string, unknown>) => string
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const ports = displayFirewallPorts(rule.protocol, rule.ports, t)
  return (
    <article className={`firewall-rule-card ${firewallActionTone(rule.action)} ${rule.enabled ? '' : 'is-disabled'}`}>
      <div className="firewall-rule-main">
        <span className="firewall-rule-action">{t(`workbench.firewall.action.${rule.action}`)}</span>
        <div>
          <strong>{t(`workbench.firewall.protocol.${rule.protocol}`)} · {ports}</strong>
          <small>{t('workbench.firewall.fromSource', { source: formatFirewallSource(rule.source) })}</small>
        </div>
      </div>
      <div className="firewall-rule-meta">
        <span>{rule.description || t('workbench.firewall.noDescription')}</span>
        {snapshotRule?.hit_count !== undefined ? <small>{t('workbench.firewall.hitCount', { count: snapshotRule.hit_count })}</small> : null}
        {snapshotRule?.byte_count !== undefined ? <small>{formatBytes(snapshotRule.byte_count)}</small> : null}
      </div>
      <div className="firewall-rule-card-actions">
        <Tooltip title={t('workbench.firewall.edit')}>
          <Button type="text" aria-label={t('workbench.firewall.edit')} icon={<Pencil size={14} />} onClick={onEdit} />
        </Tooltip>
        <Tooltip title={t('workbench.firewall.duplicate')}>
          <Button type="text" aria-label={t('workbench.firewall.duplicate')} icon={<Copy size={14} />} onClick={onDuplicate} />
        </Tooltip>
        <Popconfirm title={t('workbench.firewall.deleteConfirm')} okText={t('app.confirm')} cancelText={t('app.cancel')} onConfirm={onDelete}>
          <Button type="text" danger aria-label={t('workbench.firewall.delete')} icon={<Trash2 size={14} />} />
        </Popconfirm>
      </div>
    </article>
  )
}

function FirewallPlanChangeRow({ change, t }: { change: FirewallPlan['changes'][number]; t: (key: string, params?: Record<string, unknown>) => string }) {
  const icon = change.type === 'delete' ? <Trash2 size={14} /> : change.type === 'create' ? <Plus size={14} /> : <Pencil size={14} />
  const rule = change.after ?? change.before
  return (
    <div className={`firewall-change-row is-${change.type}`}>
      <span>{icon}</span>
      <div>
        <strong>{t(`workbench.firewall.change.${change.type}`)}</strong>
        <small>
          {rule ? `${t(`workbench.firewall.protocol.${rule.protocol}`)} · ${displayFirewallPorts(rule.protocol, rule.ports ?? [], t)} · ${formatFirewallSource(rule.source)}` : change.rule_id}
        </small>
      </div>
    </div>
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

function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
