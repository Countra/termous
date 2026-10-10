import { FeedbackMessage } from '#shared/ui'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Space, Tag } from 'antd'
import { Monitor, Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { RemoteDevice, RemotePolicy, RemoteResult } from '#common/contracts'
import { getTermousBridge } from '#shared/bridge'
import { unwrap } from '#entities/remote-control'
import { remoteCopy, remoteErrorText } from '../model/copy'
import { RemoteAccessDialog } from './RemoteAccessDialog'
import styles from './RemoteAccountAccess.module.scss'

interface Props {
  generation: string; currentDevice: string; trusted: boolean
  children(render: (device: { id: string; name: string }) => ReactNode): ReactNode
}

export function RemoteAccountAccess({ generation, currentDevice, trusted, children }: Props) {
  const { i18n } = useTranslation()
  const copy = remoteCopy(i18n.language.startsWith('zh') ? 'zh-CN' : 'en-US')
  const api = getTermousBridge()?.remoteControl
  const [devices, setDevices] = useState<RemoteDevice[]>([])
  const [policy, setPolicy] = useState<RemotePolicy>()
  const [hosts, setHosts] = useState<{ id: string; name: string }[]>([])
  const [desktops, setDesktops] = useState<{ id: string; host_id: string; name: string; protocol: string }[]>([])
  const [selectedDesktops, setSelectedDesktops] = useState<string[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [enabled, setEnabled] = useState(false)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [working, setWorking] = useState<'save' | 'agent' | 'directory' | 'desktop'>()
  const [mustRefresh, setMustRefresh] = useState(false)
  const [updated, setUpdated] = useState(false)
  const [error, setError] = useState<unknown>()
  const [connectionError, setConnectionError] = useState<unknown>()
  const lifetime = useRef(0)
  const editor = useRef(0)
  const presenceRequest = useRef(0)
  const pending = useRef(false)
  const load = useCallback(async () => {
    if (!api || !trusted) return
    const scope = lifetime.current
    const request = ++presenceRequest.current
    const current = () => scope === lifetime.current && request === presenceRequest.current
    try {
      const values = unwrap(await api.devices(generation))
      // 保存后的补读可能与轮询重叠，较早结果不能回写旧在线状态。
      if (current()) setDevices(values)
    } catch { if (current()) setDevices([]) }
  }, [api, generation, trusted])
  useEffect(() => {
    const scope = ++lifetime.current
    ++editor.current
    pending.current = false
    setOpen(false); setPolicy(undefined); setHosts([]); setSelected([]); setDevices([])
    setDesktops([]); setSelectedDesktops([])
    setLoading(false); setWorking(undefined); setError(undefined); setConnectionError(undefined); setMustRefresh(false); setUpdated(false)
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => { if (scope !== lifetime.current) return; if (!document.hidden) await load(); if (scope === lifetime.current) timer = setTimeout(() => void poll(), 15000) }
    void poll()
    return () => { lifetime.current = scope + 1; clearTimeout(timer) }
  }, [load])
  const edit = async () => {
    if (!api || !trusted || pending.current) return
    const scope = lifetime.current
    const request = ++editor.current
    const current = () => scope === lifetime.current && request === editor.current
    setOpen(true); setLoading(true); setError(undefined); setPolicy(undefined)
    setHosts([]); setSelected([]); setMustRefresh(false); setUpdated(false)
    try {
      const [policy, hosts, profiles] = await Promise.all([api.policy(generation), api.hosts(), api.desktopProfiles?.()])
      if (!current()) return
      const value = unwrap(policy)
      const availableHosts = unwrap(hosts)
      const availableIDs = new Set(availableHosts.map(host => host.id))
      setPolicy(value); setEnabled(value.enabled)
      setSelected((value.hosts ?? []).map(item => item.id).filter(id => availableIDs.has(id)))
      setHosts(availableHosts)
      setDesktops(profiles ? unwrap(profiles) : [])
      setSelectedDesktops((value.hosts ?? []).flatMap(host => (host.connections ?? []).filter(item => item.kind === 'desktop').map(item => item.id)))
    } catch (reason) { if (current()) setError(reason) } finally { if (current()) setLoading(false) }
  }
  const close = () => {
    if (pending.current) return
    ++editor.current
    setOpen(false); setLoading(false); setError(undefined)
  }
  const changePolicy = async (operation: 'save' | 'agent' | 'directory' | 'desktop', action: (revision: number) => Promise<RemoteResult<RemotePolicy | null>>) => {
    if (!api || !trusted || !policy || loading || pending.current || mustRefresh) return
    const scope = lifetime.current
    const request = editor.current
    const current = () => scope === lifetime.current && request === editor.current
    // 同一修订号只允许一个写入；同步锁也覆盖原生目录选择器尚未返回的阶段。
    pending.current = true
    setWorking(operation); setError(undefined); setUpdated(false)
    try {
      const next = unwrap(await action(policy.revision))
      if (!next || !current()) return
      setPolicy(next)
      setSelectedDesktops((next.hosts ?? []).flatMap(host => (host.connections ?? []).filter(item => item.kind === 'desktop').map(item => item.id)))
      if (operation === 'save') { setOpen(false); void load() }
      else setUpdated(true)
    } catch (reason) {
      if (current()) {
        setError(reason)
        // 修订冲突或结果未确认时先重新读取，避免重放可能已经生效的授权操作。
        if (reason && typeof reason === 'object' && (('code' in reason && String(reason.code).toLowerCase() === 'remote_policy_changed') || ('uncertain' in reason && reason.uncertain))) setMustRefresh(true)
      }
    } finally {
      if (current()) { pending.current = false; setWorking(undefined) }
    }
  }
  const connect = async (device: { id: string; name: string }) => {
    if (!api || !trusted) return
    const scope = lifetime.current
    setConnectionError(undefined)
    try { unwrap(await api.open(generation, device.id, device.name)) }
    catch (reason) {
      // 连接错误属于设备列表，不能混入授权编辑或后续账号的反馈。
      if (scope === lifetime.current) setConnectionError(reason)
    }
  }
  return <>
    {api && trusted ? <section className={styles.settings}><div><h2><Monitor size={18} />{copy.hostSettings}</h2><p>{copy.settingsHint}</p></div><Button icon={<Settings2 size={15} />} disabled={loading || !!working} onClick={() => void edit()}>{copy.configure}</Button></section> : null}
    {children(device => {
      const state = devices.find(item => item.id === device.id)
      if (device.id === currentDevice) return null
      const online = state?.online === 'online'
      const available = online && state?.advertisement.host_enabled && state.advertisement.protocol === 'termous-remote-v1'
      return <Space size="small"><Tag className={styles.status} color={online ? 'green' : undefined}>{online ? copy.online : state?.online === 'offline' ? copy.offline : copy.unknown}</Tag>{api ? <Button size="small" icon={<Monitor size={13} />} disabled={!trusted || !available} onClick={() => void connect(device)}>{copy.connect}</Button> : null}</Space>
    })}
    {connectionError ? <FeedbackMessage type="warning" title={remoteErrorText(copy, connectionError)} onClose={() => setConnectionError(undefined)} /> : null}
    <RemoteAccessDialog open={open} copy={copy} policy={policy} hosts={hosts} selected={selected} enabled={enabled} loading={loading} working={working} error={error} mustRefresh={mustRefresh} updated={updated}
      desktops={desktops} selectedDesktops={selectedDesktops} onSelectDesktops={setSelectedDesktops}
      onDesktops={api?.configureDesktops ? () => void changePolicy('desktop', revision => api.configureDesktops!(generation, revision, selectedDesktops)) : undefined}
      onClose={close} onRefresh={() => void edit()} onEnabled={setEnabled} onSelect={setSelected}
      onSave={() => { if (api) void changePolicy('save', revision => api.configure(generation, revision, enabled, selected)) }}
      onAgent={value => { if (api) void changePolicy('agent', revision => api.configureAgent(generation, revision, value)) }}
      onDirectory={(write, id) => { if (api) void changePolicy('directory', revision => id ? api.removeDirectory(generation, revision, id) : api.addDirectory(generation, revision, write)) }} />
  </>
}
