import { useState } from 'react'
import { Alert, Button, Descriptions, Modal, Space, Spin, Tag } from 'antd'
import { useTranslation } from 'react-i18next'
import { modalSurfaceStyles } from '#shared/ui'
import type { AgentIntegrationSource, AgentIntegrationsGateway } from '#entities/agent-integrations'
import { useMCPProvision, type ProvisionOperation } from '../model/useMCPProvision'

export function MCPProvisionDialog({ sources, gateway, onClose, onChanged, operation = 'enable' }: {
  operation?: ProvisionOperation; sources: AgentIntegrationSource[]; gateway: AgentIntegrationsGateway; onClose(): void; onChanged(): void
}) {
  const { t } = useTranslation()
  // 固定本次确认的来源代次，父级刷新不能在成功后自动开启下一次升级。
  const [batch] = useState(sources)
  const [index, setIndex] = useState(0)
  const source = batch[index]
  const { dependency, busy, done, error, managed, needsInstall, cancelling, load, activate, cancel } = useMCPProvision(source, gateway, operation, onChanged)
  return <Modal open centered width={650} rootClassName={modalSurfaceStyles.root} title={`${t('mcpPreparation.setupTitle')} · ${source.name}`}
    onCancel={onClose} footer={<Space>
      <Button onClick={onClose}>{t('mcpPreparation.close')}</Button>
      {error && !busy && <Button onClick={() => void load()}>{t('mcpPreparation.retry')}</Button>}
      {busy && dependency && ['preparing', 'verifying', 'resolving'].includes(dependency.state) && <Button loading={cancelling} onClick={() => void cancel()}>{t('mcpPreparation.cancelInstall')}</Button>}
      {done ? <Button type="primary" onClick={() => { if (index + 1 < batch.length) setIndex(index + 1); else onClose() }}>{t('mcpPreparation.next')}</Button>
        : <Button type="primary" loading={busy} disabled={needsInstall && (!dependency || ['failed', 'cancelled', 'uncertain'].includes(dependency.state))} onClick={() => void activate()}>{t(dependency?.state === 'preview' ? 'mcpPreparation.confirm' : 'mcpPreparation.activate')}</Button>}
    </Space>}>
    <Tag>{t(source.mcp?.transport === 'http' ? 'mcpPreparation.http' : managed ? 'mcpPreparation.managed' : 'mcpPreparation.external')}</Tag>
    <Descriptions column={1} size="small" items={[
      { key: 'command', label: t('extensions.command'), children: <code>{source.mcp?.transport === 'http' ? source.mcp.url : source.mcp?.command}</code> },
      { key: 'args', label: t('mcpPreparation.arguments'), children: <code>{JSON.stringify(source.mcp?.args ?? [])}</code> },
      { key: 'cwd', label: t('extensions.cwd'), children: source.mcp?.cwd || '—' },
      ...(dependency ? [{ key: 'package', label: t('mcpPreparation.package'), children: `${dependency.package.name}@${dependency.package.version}` },
        { key: 'root', label: t('mcpPreparation.root'), children: dependency.root },
        { key: 'state', label: t('extensions.status'), children: t(`mcpPreparation.states.${dependency.state}`) }] : []),
    ]} />
    {busy && <Spin size="small" />}
    <Alert type={done ? 'success' : 'info'} showIcon title={t(done ? 'mcpPreparation.done' : managed ? 'mcpPreparation.confirmHint' : 'mcpPreparation.startHint')} />
    {error && <Alert type="error" showIcon title={error} />}
  </Modal>
}
