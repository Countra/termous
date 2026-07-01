import { Alert, App as AntdApp, Button, Checkbox, Modal, Skeleton, Steps, Tag, Tooltip, Typography } from 'antd'
import { ClipboardCopy, FileText, PackagePlus, RefreshCw, Save, ServerCog, ShieldAlert, ShieldCheck, TerminalSquare } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { TFunction } from 'i18next'
import type { TermousApi } from '../../api/client'
import type { FirewallInstallPlan, FirewallPersistenceStatus, FirewallProvider, FirewallSaveResult } from '../../types/domain'

interface FirewallPersistencePanelProps {
  api: TermousApi
  sessionId: string
  provider: FirewallProvider
  open: boolean
  onClose: () => void
  onSaved?: () => void
  t: TFunction
}

export function FirewallPersistencePanel({ api, sessionId, provider, open, onClose, onSaved, t }: FirewallPersistencePanelProps) {
  const { notification } = AntdApp.useApp()
  const [status, setStatus] = useState<FirewallPersistenceStatus | null>(null)
  const [installPlan, setInstallPlan] = useState<FirewallInstallPlan | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [installConfirmed, setInstallConfirmed] = useState(false)

  const currentPlan = installPlan ?? status?.install_plan ?? null
  const missingTools = status?.missing_tools ?? currentPlan?.missing_tools ?? []
  const warnings = useMemo(() => {
    const values = [...(status?.warnings ?? []), ...(currentPlan?.warnings ?? [])]
    return Array.from(new Set(values.filter(Boolean)))
  }, [currentPlan?.warnings, status?.warnings])

  const loadStatus = useCallback(async () => {
    if (!open || !sessionId) {
      return
    }
    setLoading(true)
    try {
      const nextStatus = await api.sessionFirewallPersistenceStatus(sessionId, provider)
      setStatus(nextStatus)
      setInstallPlan(nextStatus.install_plan ?? null)
      setInstallConfirmed(false)
    } catch (error) {
      notification.error({
        title: t('workbench.firewall.persistence.loadFailed'),
        description: error instanceof Error ? error.message : t('app.error'),
        duration: 5,
        role: 'alert',
        className: 'termous-notification',
      })
    } finally {
      setLoading(false)
    }
  }, [api, notification, open, provider, sessionId, t])

  useEffect(() => {
    if (open) {
      void loadStatus()
    }
  }, [loadStatus, open])

  const loadInstallPlan = async () => {
    setLoading(true)
    try {
      const plan = await api.sessionFirewallPersistenceInstallPlan(sessionId, provider)
      setInstallPlan(plan)
      setInstallConfirmed(false)
    } catch (error) {
      notification.error({
        title: t('workbench.firewall.persistence.installPlanFailed'),
        description: error instanceof Error ? error.message : t('app.error'),
        duration: 5,
        role: 'alert',
        className: 'termous-notification',
      })
    } finally {
      setLoading(false)
    }
  }

  const installDependencies = async () => {
    if (!installConfirmed) {
      return
    }
    setInstalling(true)
    try {
      const result = await api.installSessionFirewallPersistence(sessionId, provider)
      setStatus(result.status)
      setInstallPlan(result.status.install_plan ?? null)
      setInstallConfirmed(false)
      notification.success({ title: result.message, duration: 4, role: 'status', className: 'termous-notification' })
    } catch (error) {
      notification.error({
        title: t('workbench.firewall.persistence.installFailed'),
        description: error instanceof Error ? error.message : t('app.error'),
        duration: 6,
        role: 'alert',
        className: 'termous-notification',
      })
      void loadStatus()
    } finally {
      setInstalling(false)
    }
  }

  const saveRules = async () => {
    setSaving(true)
    try {
      const result = await api.saveSessionFirewallPersistence(sessionId, provider)
      applySaveResult(result)
      notification[result.saved ? 'success' : 'info']({ title: result.message, duration: 4, role: 'status', className: 'termous-notification' })
      if (result.saved) {
        onSaved?.()
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

  const applySaveResult = (result: FirewallSaveResult) => {
    setStatus((current) => ({
      provider: result.provider,
      supported: true,
      status: result.status ?? current?.status ?? 'ready',
      home_dir: current?.home_dir,
      rules_path: result.rules_path ?? current?.rules_path,
      metadata_path: current?.metadata_path,
      service_name: result.service_name ?? current?.service_name,
      service_installed: result.service_enabled || current?.service_installed || false,
      service_enabled: result.service_enabled,
      systemd_available: current?.systemd_available ?? false,
      missing_tools: current?.missing_tools,
      package_manager: current?.package_manager,
      install_available: current?.install_available ?? false,
      install_plan: result.install_plan ?? current?.install_plan,
      last_saved_at: current?.last_saved_at,
      message: result.message,
      warnings: result.warnings ?? current?.warnings,
    }))
    setInstallPlan(result.install_plan ?? null)
    setInstallConfirmed(false)
  }

  return (
    <Modal open={open} centered width={620} footer={null} title={t('workbench.firewall.persistence.title')} className="termous-modal firewall-persistence-modal" onCancel={onClose}>
      <div className="firewall-persistence-panel">
        {loading && !status ? <Skeleton active paragraph={{ rows: 7 }} title={false} /> : null}
        {status ? <PersistenceSummary status={status} provider={provider} t={t} /> : null}
        {status ? <PersistenceSteps status={status} t={t} /> : null}
        {warnings.length ? <Alert type="warning" showIcon message={warnings.join(' / ')} /> : null}
        {missingTools.length ? <MissingTools tools={missingTools} packageManager={status?.package_manager} t={t} /> : null}
        {currentPlan?.commands.length ? (
          <CommandPreview plan={currentPlan} confirmed={installConfirmed} busy={installing} t={t} onConfirmChange={setInstallConfirmed} onInstall={() => void installDependencies()} />
        ) : null}
        <div className="firewall-persistence-actions">
          <Button className="secondary-button" icon={<RefreshCw size={15} />} loading={loading} onClick={() => void loadStatus()}>
            {t('workbench.firewall.persistence.redetect')}
          </Button>
          {!currentPlan?.commands.length && missingTools.length ? (
            <Button className="secondary-button" icon={<PackagePlus size={15} />} loading={loading} onClick={() => void loadInstallPlan()}>
              {t('workbench.firewall.persistence.showInstallPlan')}
            </Button>
          ) : null}
          <Button className="primary-button" icon={<Save size={15} />} loading={saving} disabled={Boolean(missingTools.length)} onClick={() => void saveRules()}>
            {t('workbench.firewall.persistence.saveCurrent')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function PersistenceSummary({ status, provider, t }: { status: FirewallPersistenceStatus; provider: FirewallProvider; t: TFunction }) {
  const tone = persistenceTone(status.status)
  return (
    <section className={`firewall-persistence-summary ${tone}`}>
      <div className="firewall-persistence-summary-head">
        <span><ServerCog size={18} /></span>
        <div>
          <strong>{t(`workbench.firewall.provider.${provider}`)}</strong>
          <small>{status.message || t('workbench.firewall.persistence.readyHint')}</small>
        </div>
        <Tag className="firewall-persistence-status-tag">{t(`workbench.firewall.persistence.status.${status.status}`)}</Tag>
      </div>
      <div className="firewall-persistence-meta-grid">
        <PersistenceMeta label={t('workbench.firewall.persistence.rulesPath')} value={status.rules_path} />
        <PersistenceMeta label={t('workbench.firewall.persistence.serviceName')} value={status.service_name || t('fields.none')} />
        <PersistenceMeta label={t('workbench.firewall.persistence.packageManager')} value={status.package_manager || t('fields.none')} />
        <PersistenceMeta label={t('workbench.firewall.persistence.systemd')} value={status.systemd_available ? t('status.available') : t('workbench.firewall.persistence.unavailable')} />
      </div>
    </section>
  )
}

function PersistenceMeta({ label, value }: { label: string; value?: string }) {
  return (
    <Tooltip title={value || ''} placement="topLeft">
      <span className="firewall-persistence-meta">
        <small>{label}</small>
        <strong>{value || '-'}</strong>
      </span>
    </Tooltip>
  )
}

function PersistenceSteps({ status, t }: { status: FirewallPersistenceStatus; t: TFunction }) {
  const current = persistenceStepCurrent(status)
  const items = [
    { title: t('workbench.firewall.persistence.step.detect'), icon: <ShieldCheck size={14} /> },
    { title: t('workbench.firewall.persistence.step.dependency'), icon: <PackagePlus size={14} /> },
    { title: t('workbench.firewall.persistence.step.save'), icon: <FileText size={14} /> },
    { title: t('workbench.firewall.persistence.step.service'), icon: <ServerCog size={14} /> },
  ]
  return <Steps className="firewall-persistence-steps" size="small" current={current} status={status.status === 'permission_denied' ? 'error' : 'process'} items={items} />
}

function MissingTools({ tools, packageManager, t }: { tools: string[]; packageManager?: string; t: TFunction }) {
  return (
    <section className="firewall-persistence-missing">
      <span><ShieldAlert size={16} /></span>
      <div>
        <strong>{t('workbench.firewall.persistence.missingTools')}</strong>
        <small>{tools.join(', ')}{packageManager ? ` · ${packageManager}` : ''}</small>
      </div>
    </section>
  )
}

function CommandPreview({
  plan,
  confirmed,
  busy,
  t,
  onConfirmChange,
  onInstall,
}: {
  plan: FirewallInstallPlan
  confirmed: boolean
  busy: boolean
  t: TFunction
  onConfirmChange: (checked: boolean) => void
  onInstall: () => void
}) {
  const copyCommands = async () => {
    await navigator.clipboard.writeText(plan.commands.map((command) => command.command).join('\n'))
  }
  return (
    <section className="firewall-persistence-command-panel">
      <div className="firewall-persistence-section-head">
        <span><TerminalSquare size={16} /></span>
        <div>
          <strong>{t('workbench.firewall.persistence.commandPreview')}</strong>
          <small>{t('workbench.firewall.persistence.commandPreviewHint')}</small>
        </div>
        <Tooltip title={t('app.copy')}>
          <Button type="text" icon={<ClipboardCopy size={14} />} onClick={() => void copyCommands()} />
        </Tooltip>
      </div>
      <div className="firewall-persistence-command-list">
        {plan.commands.map((command) => (
          <article key={command.id}>
            <span>{command.title}</span>
            <Typography.Text code>{command.command}</Typography.Text>
          </article>
        ))}
      </div>
      <div className="firewall-persistence-confirm-row">
        <Checkbox checked={confirmed} onChange={(event) => onConfirmChange(event.target.checked)}>
          {t('workbench.firewall.persistence.confirmInstall')}
        </Checkbox>
        <Button className="primary-button" icon={<PackagePlus size={15} />} loading={busy} disabled={!confirmed || busy} onClick={onInstall}>
          {t('workbench.firewall.persistence.install')}
        </Button>
      </div>
    </section>
  )
}

function persistenceTone(status: FirewallPersistenceStatus['status']) {
  if (status === 'service_enabled' || status === 'file_saved') {
    return 'is-ready'
  }
  if (status === 'missing_tools' || status === 'partial') {
    return 'is-warning'
  }
  if (status === 'permission_denied' || status === 'unsupported') {
    return 'is-error'
  }
  return 'is-neutral'
}

function persistenceStepCurrent(status: FirewallPersistenceStatus) {
  if (status.status === 'missing_tools') {
    return 1
  }
  if (status.status === 'file_saved' || status.status === 'partial') {
    return 2
  }
  if (status.status === 'service_enabled') {
    return 3
  }
  return 0
}
