import { Alert, App as AntdApp, Button, Checkbox, Modal, Skeleton, Steps, Tag, Tooltip, Typography } from 'antd'
import { ClipboardCopy, FileText, PackagePlus, RefreshCw, Save, ServerCog, ShieldAlert, ShieldCheck, TerminalSquare } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TFunction } from 'i18next'
import { TermousApiError, type TermousApi } from '../../api/client'
import type { FirewallInstallPlan, FirewallPersistenceStatus, FirewallProvider, FirewallSaveResult, SessionStatus } from '../../types/domain'

interface FirewallPersistencePanelProps {
  api: TermousApi
  sessionId: string
  sessionStatus: SessionStatus
  provider: FirewallProvider
  open: boolean
  onClose: () => void
  onSaved?: () => void
  t: TFunction
}

export function FirewallPersistencePanel({ api, sessionId, sessionStatus, provider, open, onClose, onSaved, t }: FirewallPersistencePanelProps) {
  const { notification } = AntdApp.useApp()
  const [status, setStatus] = useState<FirewallPersistenceStatus | null>(null)
  const [installPlan, setInstallPlan] = useState<FirewallInstallPlan | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [installConfirmed, setInstallConfirmed] = useState(false)
  const activeAbortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(false)
  const sessionConnected = sessionStatus === 'connected'
  const sessionConnectedRef = useRef(sessionConnected)
  const requestScopeRef = useRef({ sessionId, provider, open, sessionConnected })

  const currentPlan = installPlan ?? status?.install_plan ?? null
  const missingTools = status?.missing_tools ?? currentPlan?.missing_tools ?? []
  const warnings = useMemo(() => {
    const values = [...(status?.warnings ?? []), ...(currentPlan?.warnings ?? [])]
    return Array.from(new Set(values.filter(Boolean)))
  }, [currentPlan?.warnings, status?.warnings])

  useEffect(() => {
    sessionConnectedRef.current = sessionConnected
  }, [sessionConnected])

  requestScopeRef.current = { sessionId, provider, open, sessionConnected }

  const abortActiveRequest = useCallback(() => {
    activeAbortRef.current?.abort()
    activeAbortRef.current = null
  }, [])

  const beginRequest = useCallback(() => {
    abortActiveRequest()
    const controller = new AbortController()
    activeAbortRef.current = controller
    return controller
  }, [abortActiveRequest])

  const finishRequest = useCallback((controller: AbortController) => {
    if (activeAbortRef.current === controller) {
      activeAbortRef.current = null
    }
  }, [])

  const isCurrentRequest = useCallback((controller: AbortController, targetSessionId: string, targetProvider: FirewallProvider) => {
    const scope = requestScopeRef.current
    return (
      activeAbortRef.current === controller &&
      !controller.signal.aborted &&
      mountedRef.current &&
      scope.open &&
      scope.sessionConnected &&
      scope.sessionId === targetSessionId &&
      scope.provider === targetProvider
    )
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortActiveRequest()
    }
  }, [abortActiveRequest])

  useEffect(() => {
    if (open && sessionConnected) {
      return
    }
    abortActiveRequest()
    setLoading(false)
    setSaving(false)
    setInstalling(false)
  }, [abortActiveRequest, open, sessionConnected])

  const loadStatus = useCallback(async () => {
    if (!open || !sessionId || !sessionConnected) {
      return
    }
    const targetSessionId = sessionId
    const targetProvider = provider
    const controller = beginRequest()
    setLoading(true)
    try {
      const nextStatus = await api.sessionFirewallPersistenceStatus(targetSessionId, targetProvider, { signal: controller.signal })
      if (!isCurrentRequest(controller, targetSessionId, targetProvider)) {
        return
      }
      setStatus(nextStatus)
      setInstallPlan(nextStatus.install_plan ?? null)
      setInstallConfirmed(false)
    } catch (error) {
      if (isRequestAbort(error) || !isCurrentRequest(controller, targetSessionId, targetProvider)) {
        return
      }
      notification.error({
        title: t('workbench.firewall.persistence.loadFailed'),
        description: error instanceof Error ? error.message : t('app.error'),
        duration: 5,
        role: 'alert',
        className: 'termous-notification',
      })
    } finally {
      const ownsRequest = activeAbortRef.current === controller
      finishRequest(controller)
      if (ownsRequest && mountedRef.current) {
        setLoading(false)
      }
    }
  }, [api, beginRequest, finishRequest, isCurrentRequest, notification, open, provider, sessionConnected, sessionId, t])

  useEffect(() => {
    if (open) {
      void loadStatus()
    }
  }, [loadStatus, open])

  const loadInstallPlan = async () => {
    if (!sessionConnected) {
      notifySessionUnavailable(notification, t)
      return
    }
    const targetSessionId = sessionId
    const targetProvider = provider
    const controller = beginRequest()
    setLoading(true)
    try {
      const plan = await api.sessionFirewallPersistenceInstallPlan(targetSessionId, targetProvider, { signal: controller.signal })
      if (!isCurrentRequest(controller, targetSessionId, targetProvider)) {
        return
      }
      setInstallPlan(plan)
      setInstallConfirmed(false)
    } catch (error) {
      if (isRequestAbort(error) || !isCurrentRequest(controller, targetSessionId, targetProvider)) {
        return
      }
      notification.error({
        title: t('workbench.firewall.persistence.installPlanFailed'),
        description: error instanceof Error ? error.message : t('app.error'),
        duration: 5,
        role: 'alert',
        className: 'termous-notification',
      })
    } finally {
      const ownsRequest = activeAbortRef.current === controller
      finishRequest(controller)
      if (ownsRequest && mountedRef.current) {
        setLoading(false)
      }
    }
  }

  const installDependencies = async () => {
    if (!sessionConnected) {
      notifySessionUnavailable(notification, t)
      return
    }
    if (!installConfirmed) {
      return
    }
    const targetSessionId = sessionId
    const targetProvider = provider
    const controller = beginRequest()
    setInstalling(true)
    try {
      const result = await api.installSessionFirewallPersistence(targetSessionId, targetProvider, { signal: controller.signal })
      if (!isCurrentRequest(controller, targetSessionId, targetProvider)) {
        return
      }
      setStatus(result.status)
      setInstallPlan(result.status.install_plan ?? null)
      setInstallConfirmed(false)
      notification.success({ title: result.message, duration: 4, role: 'status', className: 'termous-notification' })
    } catch (error) {
      if (isRequestAbort(error) || !isCurrentRequest(controller, targetSessionId, targetProvider)) {
        return
      }
      notification.error({
        title: t('workbench.firewall.persistence.installFailed'),
        description: error instanceof Error ? error.message : t('app.error'),
        duration: 6,
        role: 'alert',
        className: 'termous-notification',
      })
      void loadStatus()
    } finally {
      const ownsRequest = activeAbortRef.current === controller
      finishRequest(controller)
      if (ownsRequest && mountedRef.current) {
        setInstalling(false)
      }
    }
  }

  const saveRules = async () => {
    if (!sessionConnected) {
      notifySessionUnavailable(notification, t)
      return
    }
    const targetSessionId = sessionId
    const targetProvider = provider
    const controller = beginRequest()
    setSaving(true)
    try {
      const result = await api.saveSessionFirewallPersistence(targetSessionId, targetProvider, { signal: controller.signal })
      if (!isCurrentRequest(controller, targetSessionId, targetProvider)) {
        return
      }
      applySaveResult(result)
      notification[result.saved ? 'success' : 'info']({ title: result.message, duration: 4, role: 'status', className: 'termous-notification' })
      if (result.saved && sessionConnectedRef.current) {
        onSaved?.()
      }
    } catch (error) {
      if (isRequestAbort(error) || !isCurrentRequest(controller, targetSessionId, targetProvider)) {
        return
      }
      notification.error({
        title: t('workbench.firewall.saveFailed'),
        description: error instanceof Error ? error.message : t('app.error'),
        duration: 5,
        role: 'alert',
        className: 'termous-notification',
      })
    } finally {
      const ownsRequest = activeAbortRef.current === controller
      finishRequest(controller)
      if (ownsRequest && mountedRef.current) {
        setSaving(false)
      }
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
          <CommandPreview plan={currentPlan} confirmed={installConfirmed} busy={installing} disabled={!sessionConnected} t={t} onConfirmChange={setInstallConfirmed} onInstall={() => void installDependencies()} />
        ) : null}
        <div className="firewall-persistence-actions">
          <Button className="secondary-button" icon={<RefreshCw size={15} />} loading={loading} disabled={!sessionConnected} onClick={() => void loadStatus()}>
            {t('workbench.firewall.persistence.redetect')}
          </Button>
          {!currentPlan?.commands.length && missingTools.length ? (
            <Button className="secondary-button" icon={<PackagePlus size={15} />} loading={loading} disabled={!sessionConnected} onClick={() => void loadInstallPlan()}>
              {t('workbench.firewall.persistence.showInstallPlan')}
            </Button>
          ) : null}
          <Button className="primary-button" icon={<Save size={15} />} loading={saving} disabled={Boolean(missingTools.length) || !sessionConnected} onClick={() => void saveRules()}>
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
        <span className="firewall-persistence-summary-icon"><Save size={18} /></span>
        <div>
          <strong>{t(`workbench.firewall.provider.${provider}`)}</strong>
          <small>{persistenceStatusDescription(status, t)}</small>
        </div>
        <Tag className={`firewall-persistence-status-tag ${tone}`}>{t(`workbench.firewall.persistence.status.${status.status}`)}</Tag>
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

function persistenceStatusDescription(status: FirewallPersistenceStatus, t: TFunction) {
  if (status.status === 'ready') {
    return t('workbench.firewall.persistence.readyHint')
  }
  return status.message || t('workbench.firewall.persistence.readyHint')
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
  disabled,
  t,
  onConfirmChange,
  onInstall,
}: {
  plan: FirewallInstallPlan
  confirmed: boolean
  busy: boolean
  disabled?: boolean
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
        <Button className="primary-button" icon={<PackagePlus size={15} />} loading={busy} disabled={!confirmed || busy || disabled} onClick={onInstall}>
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

function isRequestAbort(error: unknown) {
  return error instanceof TermousApiError && error.code === 'REQUEST_ABORTED'
}

function notifySessionUnavailable(notification: ReturnType<typeof AntdApp.useApp>['notification'], t: TFunction) {
  notification.warning({
    title: t('workbench.firewall.sessionUnavailable'),
    description: t('workbench.firewall.sessionUnavailableHint'),
    duration: 4,
    role: 'status',
    className: 'termous-notification',
  })
}
