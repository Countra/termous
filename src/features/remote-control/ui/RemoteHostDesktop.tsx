import type { RemoteDesktopMediaChanged } from '#entities/remote-desktop'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Spin, Tooltip } from 'antd'
import { Info, Monitor, RefreshCw, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DesktopSource } from '@termous/remote-protocol/desktop'
import type { RemoteClient } from '#entities/remote-control'
import { FeedbackMessage, SelectControl } from '#shared/ui'
import { RemoteDesktop } from './RemoteDesktop'
import styles from './RemoteHostDesktop.module.scss'

export function RemoteHostDesktop({ client, active, onMediaDetails }: { onMediaDetails?: RemoteDesktopMediaChanged; client: RemoteClient; active: boolean }) {
  const { i18n } = useTranslation()
  const zh = i18n.language?.startsWith('zh') ?? false
  const [kind, setKind] = useState<'screen' | 'window'>('screen')
  const [sources, setSources] = useState<DesktopSource[]>([])
  const [selected, setSelected] = useState<DesktopSource>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const revision = useRef(0)
  const invalidate = useCallback(() => { ++revision.current }, [])
  const load = useCallback(async () => {
    const current = ++revision.current
    setLoading(true); setError('')
    try {
      const response = await client.desktop({ action: 'sources', sourceKind: kind, continuityVersion: 1 })
      if (current !== revision.current) return
      setSources(response.sources)
    } catch { if (current === revision.current) setError(zh ? '无法读取设备桌面，请确认被控端已允许共享。' : 'Cannot list desktops. Check sharing permissions on the host.') }
    finally { if (current === revision.current) setLoading(false) }
  }, [client, kind, zh])
  useEffect(() => { void load(); return invalidate }, [load, invalidate])
  const chooseKind = (value: 'screen' | 'window') => { setSelected(undefined); setSources([]); setKind(value) }
  const target = selected?.target
  const hint = kind === 'window' ? (zh ? '窗口仅供观看，无法控制。' : 'Windows can be viewed but not controlled.') : (zh ? '控制会影响设备当前桌面；键盘输入发送到当前焦点应用。' : 'Control affects the device desktop. Keyboard input goes to the focused app.')
  return <section className={styles.panel} aria-label={zh ? '设备桌面' : 'Device desktop'}>
    <div className={styles.toolbar}>
      <div className={styles.title}><Monitor size={16} /><strong>{zh ? '设备桌面' : 'Device desktop'}</strong><Tooltip title={hint} trigger={['hover', 'focus', 'click']}><button type="button" className={styles.help} aria-label={zh ? '共享说明' : 'Sharing information'}><Info size={14} /></button></Tooltip></div>
      <div className={styles.controls}>
        <SelectControl size="small" className={styles.kind} value={kind} onChange={chooseKind} aria-label={zh ? '来源类型' : 'Source type'} options={[{ value: 'screen', label: zh ? '显示器' : 'Displays' }, { value: 'window', label: zh ? '窗口（只读）' : 'Windows (view only)' }]} />
        <SelectControl size="small" className={styles.sources} value={target?.sourceId} loading={loading} placeholder={zh ? '选择画面来源' : 'Choose a source'} aria-label={zh ? '画面来源' : 'Capture source'} options={sources.map(source => ({ value: source.target?.sourceId, label: source.title }))} onChange={id => setSelected(sources.find(source => source.target?.sourceId === id))} />
        <Tooltip title={zh ? '刷新来源' : 'Refresh sources'}><Button size="small" type="text" icon={<RefreshCw size={14} />} aria-label={zh ? '刷新来源' : 'Refresh sources'} loading={loading} onClick={() => void load()} /></Tooltip>
        {target ? <Tooltip title={zh ? '停止观看' : 'Stop viewing'}><Button size="small" type="text" icon={<X size={15} />} aria-label={zh ? '停止观看' : 'Stop viewing'} onClick={() => setSelected(undefined)} /></Tooltip> : null}
      </div>
    </div>
    {error ? <FeedbackMessage type="warning" title={error} onClose={() => setError('')} /> : null}
    <div className={styles.content}>
      {target ? <RemoteDesktop title={selected?.title} key={`${target.instanceId}:${target.sourceId}:${target.sourceGeneration}`} client={client} onMediaDetails={onMediaDetails} target={target} active={active} /> : <div className={styles.empty}>
        <span className={styles['empty-icon']}>{loading ? <Spin /> : <Monitor size={25} />}</span>
        <strong>{zh ? '选择画面来源' : 'Choose a source'}</strong>
        <p>{zh ? '选择显示器或窗口开始观看' : 'Select a display or window to view'}</p>
        <small>{hint}</small>
      </div>}
    </div>
  </section>
}
