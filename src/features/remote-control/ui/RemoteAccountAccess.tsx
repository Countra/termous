import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Alert, Button, Checkbox, Modal, Space, Switch, Tag } from 'antd'
import { FolderPlus, Monitor, Settings2, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { RemoteDevice, RemotePolicy } from '#common/contracts'
import { getTermousBridge } from '#shared/bridge'
import { unwrap } from '#entities/remote-control'
import { remoteCopy, remoteErrorText } from '../model/copy'
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
  const [selected, setSelected] = useState<string[]>([])
  const [enabled, setEnabled] = useState(false)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()
  const lifetime = useRef(0)
  const load = useCallback(async () => {
    if (!api || !trusted) return
    const scope = lifetime.current
    try {
      const values = unwrap(await api.devices(generation))
      if (scope === lifetime.current) setDevices(values)
    } catch { if (scope === lifetime.current) setDevices([]) }
  }, [api, generation, trusted])
  useEffect(() => {
    const scope = ++lifetime.current
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => { if (scope !== lifetime.current) return; if (!document.hidden) await load(); if (scope === lifetime.current) timer = setTimeout(() => void poll(), 15000) }
    void poll()
    return () => { lifetime.current = scope + 1; clearTimeout(timer) }
  }, [load])
  const edit = async () => {
    if (!api) return
    const scope = lifetime.current
    setOpen(true); setBusy(true); setError(undefined)
    try {
      const [policy, hosts] = await Promise.all([api.policy(generation), api.hosts()])
      if (scope !== lifetime.current) return
      const value = unwrap(policy)
      const availableHosts = unwrap(hosts)
      const availableIDs = new Set(availableHosts.map(host => host.id))
      setPolicy(value); setEnabled(value.enabled)
      setSelected((value.hosts ?? []).map(item => item.id).filter(id => availableIDs.has(id)))
      setHosts(availableHosts)
    } catch (reason) { if (scope === lifetime.current) setError(reason) } finally { if (scope === lifetime.current) setBusy(false) }
  }
  const save = async () => {
    if (!api || !policy) return
    const scope = lifetime.current
    setBusy(true); setError(undefined)
    try { const next = unwrap(await api.configure(generation, policy.revision, enabled, selected)); if (scope === lifetime.current) { setPolicy(next); setOpen(false); await load() } } catch (reason) { if (scope === lifetime.current) setError(reason) } finally { if (scope === lifetime.current) setBusy(false) }
  }
  const directory = async (write: boolean, id?: string) => {
    if (!api || !policy) return
    const scope = lifetime.current
    setBusy(true); setError(undefined)
    try {
      const next = unwrap(id ? await api.removeDirectory(generation, policy.revision, id) : await api.addDirectory(generation, policy.revision, write))
      if (next && scope === lifetime.current) setPolicy(next)
    } catch (reason) { if (scope === lifetime.current) setError(reason) } finally { if (scope === lifetime.current) setBusy(false) }
  }
  return <>
    {api && trusted ? <section className={styles.settings}><div><h2><Monitor size={18} />{copy.hostSettings}</h2><p>{copy.settingsHint}</p></div><Button icon={<Settings2 size={15} />} onClick={() => void edit()}>{copy.configure}</Button></section> : null}
    {children(device => {
      const state = devices.find(item => item.id === device.id)
      if (device.id === currentDevice) return null
      const online = state?.online === 'online'
      const available = online && state?.advertisement.host_enabled && state.advertisement.protocol === 'termous-remote-v1'
      return <Space size="small"><Tag color={online ? 'green' : undefined}>{online ? copy.online : state?.online === 'offline' ? copy.offline : copy.unknown}</Tag>{api ? <Button size="small" icon={<Monitor size={13} />} disabled={!trusted || !available} onClick={() => void api.open(generation, device.id, device.name).then(unwrap).catch(setError)}>{copy.connect}</Button> : null}</Space>
    })}
    {error && !open ? <Alert type="warning" title={remoteErrorText(copy, error)} closable onClose={() => setError(undefined)} /> : null}
    <Modal title={copy.configure} open={open} width={640} onCancel={() => setOpen(false)} onOk={() => void save()} confirmLoading={busy} okText={copy.save} cancelText={copy.cancel} okButtonProps={{ disabled: !policy }}>
      <div className={styles.form}>{error ? <Alert type="warning" title={remoteErrorText(copy, error)} action={<Button size="small" onClick={() => void edit()}>{copy.refresh}</Button>} /> : null}<p>{copy.settingsHint}</p><Space><Switch checked={enabled} disabled={busy || !policy} onChange={setEnabled} aria-label={copy.hostSettings} /><strong>{copy.hostSettings}</strong></Space><h3>{copy.allowedHosts}</h3><Checkbox.Group className={styles.choices} value={selected} disabled={busy || !policy} onChange={values => setSelected(values as string[])} options={hosts.map(profile => ({ value: profile.id, label: profile.name }))} /><h3>{copy.allowedFolders}</h3>{(policy?.directories ?? []).map(root => <div key={root.id} className={styles.directory}><div><strong>{root.name}</strong><small>{root.path}</small></div><Tag>{root.write ? `${copy.read} / ${copy.write}` : copy.read}</Tag><Button type="text" danger disabled={busy} icon={<Trash2 size={15} />} aria-label={copy.remove} onClick={() => void directory(false, root.id)} /></div>)}<Space wrap><Button disabled={busy || !policy} icon={<FolderPlus size={15} />} onClick={() => void directory(false)}>{copy.addRead}</Button><Button disabled={busy || !policy} icon={<FolderPlus size={15} />} onClick={() => void directory(true)}>{copy.addWrite}</Button></Space></div>
    </Modal>
  </>
}
