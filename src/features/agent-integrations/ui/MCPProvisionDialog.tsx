import { useState } from 'react'
import { Button, Modal, Skeleton, Spin } from 'antd'
import { ArrowRight, Check, CircleAlert, Info, Package, PlugZap, Terminal, Unplug } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { FeedbackMessage, modalSurfaceStyles } from '#shared/ui'
import type { AgentIntegrationSource, AgentIntegrationsGateway } from '#entities/agent-integrations'
import { useMCPProvision, type ProvisionOperation } from '../model/useMCPProvision'
import styles from './MCPProvisionDialog.module.scss'

export function MCPProvisionDialog({ sources, gateway, onClose, onChanged, operation = 'enable' }: {
  operation?: ProvisionOperation; sources: AgentIntegrationSource[]; gateway: AgentIntegrationsGateway; onClose(): void; onChanged(): void
}) {
  const { t } = useTranslation()
  // 固定本次确认的来源代次，父级刷新不能在成功后自动开启下一次升级。
  const [batch] = useState(sources)
  const [index, setIndex] = useState(0)
  const source = batch[index]
  const { dependency, busy, done, error, managed, needsInstall, cancelling, load, activate, cancel } = useMCPProvision(source, gateway, operation, onChanged)
  const http = source.mcp?.transport === 'http'
  const installing = busy && dependency && ['preparing', 'verifying', 'resolving'].includes(dependency.state)
  const hasNext = index + 1 < batch.length
  const title = t(operation === 'upgrade' ? 'mcpPreparation.upgradeTitle' : operation === 'repair' ? 'mcpPreparation.repairTitle' : 'mcpPreparation.setupTitle')
  return <Modal open centered width={720} rootClassName={modalSurfaceStyles.root} className={styles.modal}
    title={<div className={styles.title}><PlugZap size={18} /><span>{title}</span></div>}
    onCancel={onClose} footer={<div className={styles.footer}>
      <span className={styles['footer-note']}>{batch.length > 1 ? t('mcpPreparation.batchPosition', { current: index + 1, total: batch.length }) : installing ? t('mcpPreparation.backgroundInstall') : undefined}</span>
      <div className={styles.actions}>
      {!done && <Button onClick={onClose}>{t('mcpPreparation.close')}</Button>}
      {error && !busy && <Button onClick={() => void load()}>{t('mcpPreparation.retry')}</Button>}
      {installing && <Button loading={cancelling} onClick={() => void cancel()}>{t('mcpPreparation.cancelInstall')}</Button>}
      {done ? <Button type="primary" icon={hasNext ? <ArrowRight size={14} /> : <Check size={14} />} onClick={() => { if (hasNext) setIndex(index + 1); else onClose() }}>{t(hasNext ? 'mcpPreparation.next' : 'mcpPreparation.finish')}</Button>
        : <Button type="primary" loading={busy} disabled={needsInstall && (!dependency || ['failed', 'cancelled', 'uncertain'].includes(dependency.state))} onClick={() => void activate()}>{t(dependency?.state === 'preview' ? 'mcpPreparation.confirm' : 'mcpPreparation.activate')}</Button>}
      </div>
    </div>}>
    <div className={styles.body}>
      <div className={styles.identity}>
        <span className={styles['source-icon']}>{http ? <Unplug size={23} strokeWidth={1.5} /> : <Terminal size={23} strokeWidth={1.5} />}</span>
        <div className={styles['source-name']}><strong>{source.name}</strong><span>{t(http ? 'mcpPreparation.http' : managed ? 'mcpPreparation.managed' : 'mcpPreparation.external')}</span></div>
        <span className={styles.status} data-tone={done ? 'success' : error ? 'error' : undefined} role="status" aria-live="polite">
          {busy ? <Spin size="small" /> : done ? <Check size={14} /> : error ? <CircleAlert size={14} /> : undefined}
          {t(busy ? 'extensions.processing' : done ? 'mcpPreparation.done' : error ? 'mcpPreparation.incomplete' : needsInstall && dependency?.state !== 'ready' ? 'mcpPreparation.states.preview' : 'mcpPreparation.awaitingValidation')}
        </span>
      </div>
      <section className={styles.section} aria-label={t('mcpPreparation.connectionDetails')}>
        <h4>{t('mcpPreparation.connectionDetails')}</h4>
        <dl className={styles.facts}>
          {http ? <>
            <div><dt>{t('extensions.url')}</dt><dd><code>{source.mcp?.url}</code></dd></div>
            <div><dt>{t('extensions.auth')}</dt><dd>{source.mcp?.auth === 'oauth' ? 'OAuth' : t(source.mcp?.auth === 'headers' ? 'extensions.headerAuth' : 'extensions.noAuth')}</dd></div>
          </> : <>
            <div><dt>{t('extensions.command')}</dt><dd><code>{source.mcp?.command}</code></dd></div>
            <div><dt>{t('mcpPreparation.arguments')}</dt><dd><code>{JSON.stringify(source.mcp?.args ?? [])}</code></dd></div>
            {source.mcp?.cwd && <div><dt>{t('extensions.cwd')}</dt><dd><code>{source.mcp.cwd}</code></dd></div>}
          </>}
        </dl>
      </section>
      {managed && <section className={styles.section} aria-label={t('mcpPreparation.installationDetails')}>
        <h4>{t('mcpPreparation.installationDetails')}</h4>
        <div className={styles.installation}>
          {dependency ? <>
            <div className={styles.package}><Package size={17} /><code>{dependency.package.name}@{dependency.package.version}</code>
              <span className={styles['installation-state']} data-ready={dependency.state === 'ready' || undefined}>{t(`mcpPreparation.states.${dependency.state}`)}</span>
            </div>
            <dl className={styles.facts}>
              {dependency.root && <div><dt>{t('mcpPreparation.root')}</dt><dd><code>{dependency.root}</code></dd></div>}
              {dependency.package.entry && <div><dt>{t('mcpPreparation.entry')}</dt><dd><code>{dependency.package.entry}</code></dd></div>}
            </dl>
          </> : busy ? <Skeleton active title={false} paragraph={{ rows: 2 }} /> : <p className={styles.unavailable}>{t('mcpPreparation.installationUnavailable')}</p>}
          {needsInstall && !done && dependency?.state === 'preview' && <p className={styles['install-hint']}>{t('mcpPreparation.installPolicy')}</p>}
          {operation !== 'enable' && !done && <p className={styles['install-hint']}>{t('mcpPreparation.candidatePolicy')}</p>}
        </div>
      </section>}
      {!done && <p className={styles.policy}><Info size={14} /><span>{t('mcpPreparation.startHint')}</span></p>}
    </div>
    {error && <FeedbackMessage type="error" title={error} />}
  </Modal>
}
