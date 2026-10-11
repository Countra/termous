import { useEffect, useRef, useState } from 'react'
import { Button, Drawer, Spin, Tooltip } from 'antd'
import { FolderOpen, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DesktopExchange, RemoteDesktopSession } from '@termous/remote-protocol/desktop'
import type { RemoteLocalTask } from '#common/contracts'
import type { RemoteClient, Session } from '#entities/remote-control'
import { remoteCopy, remoteErrorText } from '../model/copy'
import { RemoteFeedback } from './RemoteFeedback'
import { RemoteFiles } from './RemoteFiles'
import styles from './RemoteDesktopFiles.module.scss'

interface Props {
  client: RemoteClient
  session: Session
  desktop?: Pick<RemoteDesktopSession, 'openFileExchange'>
  available: boolean
  localTasks: RemoteLocalTask[]
  changed(): void
  getContainer(): HTMLElement
}

// 文件入口独立呈现请求状态，不让授权或映射失败覆盖桌面观看状态。
export function RemoteDesktopFiles({ client, session, desktop, available, localTasks, changed, getContainer }: Props) {
  const { i18n } = useTranslation()
  const copy = remoteCopy(i18n.language?.startsWith('zh') ? 'zh-CN' : 'en-US')
  const [open, setOpen] = useState(false)
  const [exchange, setExchange] = useState<DesktopExchange>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<{ code: string; uncertain: boolean }>()
  const requests = useRef({ revision: 0, pending: false })
  useEffect(() => {
    const current = requests.current
    current.revision++
    current.pending = false
    setOpen(false); setLoading(false); setError(undefined)
    return () => { current.revision++ }
  }, [desktop, available])

  const load = async () => {
    const current = requests.current
    if (!available || !desktop || current.pending) return
    const request = ++current.revision
    current.pending = true
    setOpen(true); setLoading(true); setError(undefined)
    try {
      const value = await desktop.openFileExchange(exchange)
      if (request === current.revision) setExchange(value)
    } catch (reason) {
      if (request === current.revision) {
        const raw = reason && typeof reason === 'object' && 'code' in reason ? String(reason.code).toLowerCase() : reason instanceof Error ? reason.message : ''
        const code = /^[a-z][a-z0-9_]{1,95}$/.test(raw) ? raw : 'desktop_files_failed'
        setError({ code, uncertain: !!(reason && typeof reason === 'object' && 'uncertain' in reason && reason.uncertain) })
      }
    } finally {
      if (request === current.revision) { current.pending = false; setLoading(false) }
    }
  }

  return <>
    <Tooltip title={copy.desktopExchange}><Button size="small" type="text" disabled={!available || !desktop || loading} icon={<FolderOpen size={16} />} aria-label={copy.desktopExchange} onClick={() => void load()} /></Tooltip>
    <Drawer title={copy.desktopExchange} open={open && available} onClose={() => setOpen(false)} size="min(760px, 100vw)" destroyOnHidden getContainer={getContainer} classNames={{ section: styles.panel, body: styles.body }}>
      <p className={styles.hint}>{copy.desktopExchangeUsage}</p>
      {loading ? <div className={styles.loading} role="status"><Spin size="small" /><span>{copy.desktopFilesPreparing}</span></div> : error ? <>
        <RemoteFeedback message={remoteErrorText(copy, error)} action={<Button size="small" icon={<RefreshCw size={14} />} onClick={() => void load()}>{copy.retry}</Button>} />
        <code className={styles.code}>{error.code}</code>
      </> : exchange ? <>
        <code className={styles.path}>{exchange.targetPath}</code>
        <RemoteFiles key={`${exchange.id}:${exchange.resourceGeneration}`} client={client} session={session} exchange={exchange} copy={copy} roots={[]} operations={[]} localTasks={localTasks} changed={changed} />
      </> : null}
    </Drawer>
  </>
}
