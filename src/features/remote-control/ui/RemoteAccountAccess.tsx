import { FeedbackMessage } from '#shared/ui'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Button, Space, Tag } from 'antd'
import { Monitor, Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { RemoteDevice } from '#common/contracts'
import { getTermousBridge } from '#shared/bridge'
import { unwrap } from '#entities/remote-control'
import { remoteCopy, remoteErrorText } from '../model/copy'
import { PolicyEditor } from '../model/policyEditor'
import { RemoteAccessDialog } from './RemoteAccessDialog'
import { HostDesktopAccesses } from './HostDesktopAccesses'
import styles from './RemoteAccountAccess.module.scss'

interface Props {
  generation: string; currentDevice: string; trusted: boolean
  children(render: (device: { id: string; name: string }) => ReactNode): ReactNode
}

export function RemoteAccountAccess({ generation, currentDevice, trusted, children }: Props) {
  const { i18n } = useTranslation()
  const copy = remoteCopy(i18n.language.startsWith('zh') ? 'zh-CN' : 'en-US')
  const api = getTermousBridge()?.remoteControl
  const editor = useMemo(() => new PolicyEditor(trusted ? api : undefined, generation), [api, generation, trusted])
  const state = useSyncExternalStore(editor.subscribe, editor.snapshot)
  useEffect(() => () => editor.dispose(), [editor])
  const [devices, setDevices] = useState<RemoteDevice[]>([])
  const [connectionError, setConnectionError] = useState<unknown>()
  const lifetime = useRef(0)
  const presenceRequest = useRef(0)
  const load = useCallback(async () => {
    if (!api || !trusted) return
    const scope = lifetime.current
    const request = ++presenceRequest.current
    const current = () => scope === lifetime.current && request === presenceRequest.current
    try {
      const values = unwrap(await api.devices(generation))
      if (current()) setDevices(values)
    } catch { if (current()) setDevices([]) }
  }, [api, generation, trusted])
  useEffect(() => {
    const scope = ++lifetime.current
    setDevices([]); setConnectionError(undefined)
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      if (scope !== lifetime.current) return
      if (!document.hidden) await load()
      if (scope === lifetime.current) timer = setTimeout(() => void poll(), 15000)
    }
    void poll()
    return () => { lifetime.current = scope + 1; clearTimeout(timer) }
  }, [load])
  const connect = async (device: { id: string; name: string }) => {
    if (!api || !trusted) return
    const scope = lifetime.current
    setConnectionError(undefined)
    try { unwrap(await api.open(generation, device.id, device.name)) }
    catch (reason) { if (scope === lifetime.current) setConnectionError(reason) }
  }
  return <>
    {api && trusted ? <section className={styles.settings} data-tour="remote-permissions"><div><h2><Monitor size={18} />{copy.hostSettings}</h2><p>{copy.settingsHint}</p></div><Button icon={<Settings2 size={15} />} onClick={() => void editor.open()}>{copy.configure}</Button></section> : null}
    {children(device => {
      const deviceState = devices.find(item => item.id === device.id)
      if (device.id === currentDevice) return null
      const online = deviceState?.online === 'online'
      const available = online && deviceState.advertisement.host_enabled && deviceState.advertisement.protocol === 'termous-remote-v1'
      return <Space size="small"><Tag className={styles.status} color={online ? 'green' : undefined}>{online ? copy.online : deviceState?.online === 'offline' ? copy.offline : copy.unknown}</Tag>{api ? <Button size="small" icon={<Monitor size={13} />} disabled={!trusted || !available} onClick={() => void connect(device)}>{copy.connect}</Button> : null}</Space>
    })}
    {connectionError ? <FeedbackMessage type="warning" title={remoteErrorText(copy, connectionError)} onClose={() => setConnectionError(undefined)} /> : null}
    <RemoteAccessDialog copy={copy} state={state} change={change => editor.change(change)} onClose={() => { if (editor.close()) void load() }}
      onRefresh={() => void editor.refresh()} onDirectory={write => void editor.directory(write)}
      hostDesktopAccesses={state.open && api ? <HostDesktopAccesses api={api} generation={generation} /> : undefined} />
  </>
}
