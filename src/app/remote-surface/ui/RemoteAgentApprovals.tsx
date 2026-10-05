import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Badge, Button, Drawer, Empty, Space } from 'antd'
import { ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AgentQuery_Kind as Q } from '@termous/remote-protocol/agent'
import type { McpApproval } from '#entities/mcp-access'
import type { RemoteBootstrap } from '#common/contracts'
import { decodeMcpApprovalSnapshot, McpApprovalDetails, McpApprovalExpiry } from '#features/mcp-access'
import { RemoteError } from '#entities/remote-control'
import { RemoteAgentTransport, object, revision } from '../api/agentTransport.ts'

type Approval = { value: McpApproval; run: string; generation: number; instance: string }

export function RemoteAgentApprovals({ transport, target }: { transport: RemoteAgentTransport; target?: RemoteBootstrap['agentTarget'] }) {
  const { t } = useTranslation()
  const [items, setItems] = useState<Approval[]>([])
  const [open, setOpen] = useState(false)
  useEffect(() => { if (target?.approvalId) setOpen(true) }, [target])
  const [busy, setBusy] = useState('')
  const [failed, setFailed] = useState(false)
  const [now, setNow] = useState(Date.now)
  const lifetime = useRef(0)
  const read = useCallback(async () => {
    const epoch = lifetime.current
    const raw = object(await transport.query('approvals', Q.APPROVALS))
    const snapshot = decodeMcpApprovalSnapshot(raw)
    const source = raw.items as unknown[]
    const values = snapshot.items.filter(value => value.state === 'pending').map(value => {
      const extra = object(source.find(item => object(item).id === value.id))
      if (typeof extra.run_id !== 'string' || typeof extra.generation !== 'number' || !Number.isSafeInteger(extra.generation) || extra.generation < 1) throw new RemoteError('remote_invalid')
      return { value, run: extra.run_id, generation: extra.generation, instance: snapshot.instance_id }
    })
    if (epoch === lifetime.current) { setItems(values); setFailed(false) }
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
    if (busy || Date.parse(item.value.expires_at) <= Date.now()) return
    setBusy(item.value.id)
    try {
      await transport.write('approval', { case: 'approval', value: { id: item.value.id, instanceId: item.instance, runId: item.run, generation: revision(item.generation), expectedRevision: revision(item.value.revision), approve } })
      await read()
    } catch { if (epoch === lifetime.current) { setFailed(true); await read().catch(() => setFailed(true)) } }
    finally { if (epoch === lifetime.current) setBusy('') }
  }
  return <>
    <Badge count={items.length} size="small"><Button icon={<ShieldCheck size={16} />} onClick={() => setOpen(true)}>{t('agent.remoteApprovals')}</Button></Badge>
    <Drawer title={t('agent.remoteApprovals')} open={open} onClose={() => setOpen(false)} size={560}>
      {failed ? <Alert type="warning" showIcon title={t('settings.mcp.operationFailed')} action={<Button onClick={() => void read().catch(() => setFailed(true))}>{t('app.retry')}</Button>} /> : null}
      {!items.length ? <Empty /> : <Space orientation="vertical" size="large" style={{ width: '100%' }}>{items.map(item => {
        const seconds = Math.max(0, Math.ceil((Date.parse(item.value.expires_at) - now) / 1000))
        return <section key={`${item.instance}:${item.value.id}`}><McpApprovalDetails approval={item.value} /><Space wrap><McpApprovalExpiry expired={!seconds} remainingSeconds={seconds} /><Button danger disabled={!!busy || !seconds} onClick={() => void decide(item, false)}>{t('settings.mcp.approval.reject')}</Button><Button type="primary" loading={busy === item.value.id} disabled={!!busy || !seconds} onClick={() => void decide(item, true)}>{t('settings.mcp.approval.allowOnce')}</Button></Space></section>
      })}</Space>}
    </Drawer>
  </>
}
