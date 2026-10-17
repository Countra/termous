import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Drawer, Empty } from 'antd'
import { ServerCog, ShieldCheck, ShieldX, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AgentQuery_Kind as Q } from '@termous/remote-protocol/agent'
import type { McpApproval } from '#entities/mcp-access'
import type { RemoteBootstrap } from '#common/contracts'
import { decodeMcpApprovalSnapshot, McpApprovalDetails, McpApprovalExpiry, mcpApprovalStyles } from '#features/mcp-access'
import { RemoteError } from '#entities/remote-control'
import { RemoteFeedback, remoteCopy, remoteErrorText } from '#features/remote-control'
import { RemoteAgentTransport, object, revision } from '../api/agentTransport.ts'
import styles from './RemoteAgentApprovals.module.scss'

type Approval = { value: McpApproval; run: string; generation: number; instance: string }

export function RemoteAgentApprovals({ transport, target }: { transport: RemoteAgentTransport; target?: RemoteBootstrap['agentTarget'] }) {
  const { t, i18n } = useTranslation()
  const copy = remoteCopy(i18n.language.startsWith('zh') ? 'zh-CN' : 'en-US')
  const [items, setItems] = useState<Approval[]>([])
  const [open, setOpen] = useState(false)
  useEffect(() => { if (target?.approvalId) setOpen(true) }, [target])
  const [busy, setBusy] = useState('')
  const [failed, setFailed] = useState(false)
  const [operationError, setOperationError] = useState<unknown>()
  const [now, setNow] = useState(Date.now)
  const lifetime = useRef(0)
  const readVersion = useRef(0)
  const read = useCallback(async () => {
    const epoch = lifetime.current
    const version = ++readVersion.current
    try {
      const raw = object(await transport.query('approvals', Q.APPROVALS))
      const snapshot = decodeMcpApprovalSnapshot(raw)
      const source = raw.items as unknown[]
      const values = snapshot.items.filter(value => value.state === 'pending').map(value => {
        const extra = object(source.find(item => object(item).id === value.id))
        if (typeof extra.run_id !== 'string' || typeof extra.generation !== 'number' || !Number.isSafeInteger(extra.generation) || extra.generation < 1) throw new RemoteError('remote_invalid')
        return { value, run: extra.run_id, generation: extra.generation, instance: snapshot.instance_id }
      })
      if (epoch === lifetime.current && version === readVersion.current) { setItems(values); setFailed(false) }
    } catch (error) {
      if (epoch === lifetime.current && version === readVersion.current) throw error
    }
  }, [transport])
  useEffect(() => {
    const epoch = ++lifetime.current
    let active = true
    let pending = false
    const refresh = () => {
      if (pending || !active) return
      pending = true
      void read().catch(() => { if (active) setFailed(true) }).finally(() => { pending = false })
    }
    const stop = transport.client.onEvent(event => { if (event.value.case === 'agent') refresh() })
    const timer = setInterval(() => { setNow(Date.now()); refresh() }, 3000)
    refresh()
    return () => { active = false; lifetime.current = epoch + 1; stop(); clearInterval(timer) }
  }, [read, transport])
  const decide = async (item: Approval, approve: boolean) => {
    const epoch = lifetime.current
    if (busy || failed || Date.parse(item.value.expires_at) <= Date.now()) return
    setBusy(item.value.id)
    setOperationError(undefined)
    try {
      await transport.write('approval', { case: 'approval', value: { id: item.value.id, instanceId: item.instance, runId: item.run, generation: revision(item.generation), expectedRevision: revision(item.value.revision), approve } })
    } catch (error) { if (epoch === lifetime.current) setOperationError(error) }
    finally {
      if (epoch === lifetime.current) {
        // 读取恢复不能清除批准结果未明或版本冲突；也不能把批准后的补读失败描述成批准失败。
        await read().catch(() => { if (epoch === lifetime.current) setFailed(true) })
        if (epoch === lifetime.current) setBusy('')
      }
    }
  }
  return <>
    <Button type="text" className={styles.trigger} icon={<ShieldCheck size={16} />} aria-label={t('agent.remoteApprovals')} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>{t('agent.remoteApprovals')}{items.length ? <span className={styles.count} aria-hidden>{items.length}</span> : null}</Button>
    <Drawer title={<div className={styles.heading}><ShieldCheck size={18} /><span>{t('agent.remoteApprovals')}</span><span className={styles.count}>{items.length}</span></div>}
      rootClassName={styles.root} classNames={{ section: styles.panel, header: styles.header, body: styles.body, close: styles.close, wrapper: styles.wrapper, footer: styles.feedback }}
      footer={operationError || failed ? <>
        {operationError ? <RemoteFeedback message={remoteErrorText(copy, operationError)} closeLabel={t('app.close')} onClose={() => setOperationError(undefined)} action={<Button size="small" aria-label={copy.refresh} onClick={() => void read().catch(() => setFailed(true))}>{copy.refresh}</Button>} /> : null}
        {failed ? <RemoteFeedback message={copy.agentApprovalsUnavailable} action={<Button size="small" onClick={() => void read().catch(() => setFailed(true))}>{t('app.retry')}</Button>} /> : null}
      </> : null}
      closeIcon={<X size={17} />} closable={{ placement: 'end', 'aria-label': t('app.close') }} destroyOnHidden open={open} onClose={() => setOpen(false)} size={560}>
      {!items.length ? <Empty className={styles.empty} image={Empty.PRESENTED_IMAGE_SIMPLE} description={copy.agentNoApprovals} /> : <div className={styles.list}>{items.map(item => {
        const seconds = Math.max(0, Math.ceil((Date.parse(item.value.expires_at) - now) / 1000))
        return <section className={styles.card} key={`${item.instance}:${item.value.id}`}>
          <div className={mcpApprovalStyles.content}>
            <div className={mcpApprovalStyles.client}><ServerCog size={15} /><span>{t('settings.mcp.approval.client')}</span><strong>{item.value.client_name || item.value.client_id}</strong></div>
            <McpApprovalDetails approval={item.value} />
          </div>
          <div className={`${mcpApprovalStyles.footer} ${styles.footer}`}><McpApprovalExpiry expired={!seconds} remainingSeconds={seconds} /><div className={mcpApprovalStyles.actions}>
            <Button danger icon={<ShieldX size={15} />} disabled={!!busy || failed || !seconds} onClick={() => void decide(item, false)}>{t('settings.mcp.approval.reject')}</Button>
            <Button type="primary" icon={<ShieldCheck size={15} />} loading={busy === item.value.id} disabled={!!busy || failed || !seconds} onClick={() => void decide(item, true)}>{t('settings.mcp.approval.allowOnce')}</Button>
          </div></div>
        </section>
      })}</div>}
    </Drawer>
  </>
}
