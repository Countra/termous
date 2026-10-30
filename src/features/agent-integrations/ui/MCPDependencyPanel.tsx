import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Collapse, Descriptions, Space, Tag } from 'antd'
import { useTranslation } from 'react-i18next'
import type { AgentIntegrationSource, AgentIntegrationsGateway, MCPDependency } from '#entities/agent-integrations'
import styles from './MCPDependencyPanel.module.scss'
import { MCPProvisionDialog } from './MCPProvisionDialog'
import type { ProvisionOperation } from '../model/useMCPProvision'

export function MCPDependencyPanel({ source, gateway, onChanged }: {
  source: AgentIntegrationSource; gateway: AgentIntegrationsGateway; onChanged(source: AgentIntegrationSource): void
}) {
  const { t } = useTranslation()
  const [current, setCurrent] = useState<MCPDependency | null>(null)
  const [operation, setOperation] = useState<ProvisionOperation>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [logs, setLogs] = useState('')
  const [logsOpen, setLogsOpen] = useState(false)
  const [logsTruncated, setLogsTruncated] = useState(false)
  const pending = useRef<AbortController | null>(null)
  const offsets = useRef({ stdout: 0, stderr: 0 })
  const logTask = useRef<string | undefined>(undefined)
  const active = current?.state === 'resolving' || current?.state === 'preparing' || current?.state === 'verifying'
  const load = useCallback(async (signal: AbortSignal) => {
    const value = await gateway.dependency(source.id, source.revision, signal)
    if (!signal.aborted) {
      // 日志游标属于安装任务，不能沿用到下一次升级或修复。
      if (logTask.current !== value?.id) {
        logTask.current = value?.id
        offsets.current = { stdout: 0, stderr: 0 }
        setLogs(''); setLogsOpen(false); setLogsTruncated(false)
      }
      setCurrent(value)
    }
  }, [gateway, source.id, source.revision])
  useEffect(() => {
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const update = async () => {
      try { await load(abort.signal) }
      catch (error) { if (!abort.signal.aborted) setError(String(error instanceof Error ? error.message : error)) }
      finally { if (!abort.signal.aborted && active) timer = setTimeout(() => { void update() }, 1500) }
    }
    void update()
    return () => { abort.abort(); clearTimeout(timer) }
  }, [load, active])
  useEffect(() => () => pending.current?.abort(), [])
  const perform = async (operation: (signal: AbortSignal) => Promise<void>) => {
    if (pending.current) return
    const abort = new AbortController(); pending.current = abort
    setBusy(true); setError('')
    try { await operation(abort.signal) }
    catch (error) { if (!abort.signal.aborted) setError(error instanceof Error ? error.message : t('extensions.failed')) }
    finally { if (pending.current === abort) pending.current = null; if (!abort.signal.aborted) setBusy(false) }
  }
  const readLogs = () => perform(async signal => {
    const task = logTask.current
    const output = await gateway.dependencyOutput(source.id, source.revision, offsets.current.stdout, offsets.current.stderr, signal)
    if (signal.aborted || task !== logTask.current) return
    offsets.current = { stdout: output.stdout.next_offset, stderr: output.stderr.next_offset }
    const text = [output.stdout, output.stderr].map((stream, index) => {
      const tail = stream.tail ? `\n[${t('mcpPreparation.tail', { offset: stream.tail.offset })}]\n${stream.tail.text}` : ''
      return `${index === 1 ? '\n[stderr]\n' : ''}${stream.text}${tail}`
    }).join('')
    setLogs(value => (value + text).slice(-64 * 1024))
    setLogsTruncated(value => value || output.stdout.truncated || output.stderr.truncated)
    setLogsOpen(true)
  })
  const item = current
  return <Collapse size="small" items={[{ key: 'dependency', label: t('mcpPreparation.title'), extra: current && <Tag>{t(`mcpPreparation.states.${current.state}`)}</Tag>, children:
    <div className={styles.panel}>
      {item && <Descriptions size="small" column={1} items={[
        { key: 'package', label: t('mcpPreparation.package'), children: <code>{item.package.name}@{item.package.version}</code> },
        { key: 'entry', label: t('mcpPreparation.entry'), children: <code>{item.package.entry}</code> },
        { key: 'node', label: 'Node.js', children: <code>{item.runtime.node}</code> },
        { key: 'args', label: t('mcpPreparation.arguments'), children: <code>{JSON.stringify(item.package.arguments)}</code> },
      ]} />}
      {(error || current?.error) && <Alert showIcon type="error" title={error || current?.error} />}
      <Space wrap>
        <Button disabled={busy || active} onClick={() => setOperation(source.mcp?.dependency_id ? 'upgrade' : 'enable')}>{t(current ? 'mcpPreparation.prepareAgain' : 'mcpPreparation.prepare')}</Button>
        {source.mcp?.dependency_id && <Button disabled={busy || active} onClick={() => setOperation('repair')}>{t('mcpPreparation.repair')}</Button>}
        {active && <Button disabled={busy} onClick={() => void perform(async signal => {
          await gateway.cancelDependency(source.id, source.revision, signal); await load(signal)
        })}>{t('extensions.cancel')}</Button>}
        {current?.task_id && <Button disabled={busy} onClick={() => void readLogs()}>{t(logsOpen ? 'mcpPreparation.moreLogs' : 'mcpPreparation.logs')}</Button>}
      </Space>
      {logsOpen && <>
        {logsTruncated && <span>{t('mcpPreparation.truncated')}</span>}
        <pre className={styles.logs}>{logs || t('mcpPreparation.noLogs')}</pre>
      </>}
      {operation && <MCPProvisionDialog sources={[source]} gateway={gateway} operation={operation} onClose={() => { setOperation(undefined); void perform(signal => load(signal)) }} onChanged={() => {
        void perform(async signal => { const sources = await gateway.sources(signal); const updated = sources.find(value => value.id === source.id); if (updated) onChanged(updated) })
      }} />}
    </div>,
  }]} />
}
