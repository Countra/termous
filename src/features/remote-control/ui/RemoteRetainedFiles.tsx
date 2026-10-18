import { useEffect, useState } from 'react'
import { Button, Drawer, Spin, Tooltip } from 'antd'
import { ArrowLeft, ChevronRight, Clock3, FolderOpen, RefreshCw } from 'lucide-react'
import type { DesktopExchange } from '@termous/remote-protocol/desktop'
import type { RemoteClient } from '#entities/remote-control'
import type { RemoteLocalTask } from '#common/contracts'
import { formatDate } from '#shared/format'
import { type RemoteCopy, remoteErrorText } from '../model/copy'
import { RemoteFeedback } from './RemoteFeedback'
import { RemoteFiles } from './RemoteFiles'
import styles from './RemoteRetainedFiles.module.scss'

interface Props {
  client: RemoteClient
  copy: RemoteCopy
  localTasks?: RemoteLocalTask[]
  changed(): void
  getContainer(): HTMLElement
}

function expiry(value: bigint) {
  const date = new Date(Number(value))
  return Number.isFinite(date.getTime()) && Number(value) > 0 ? formatDate(date.toISOString()) : '—'
}

export function RemoteRetainedFiles({ client, copy, localTasks, changed, getContainer }: Props) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<DesktopExchange>()
  const [values, setValues] = useState<DesktopExchange[]>([])
  const [cursor, setCursor] = useState('')
  const [error, setError] = useState<unknown>()
  const [loading, setLoading] = useState(false)
  const [revision, setRevision] = useState(0)
  const [next, setNext] = useState('')
  useEffect(() => {
    if (!open) return
    let alive = true
    setLoading(true); setError(undefined)
    void client.request({ operation: { case: 'file', value: { action: 'retained_list', cursor: next, location: { kind: 'desktop_exchange', resourceId: 'retained', path: '/' } } } }).then(response => {
      if (!alive) return
      if (response.result.case !== 'desktop') throw new Error('remote_invalid_response')
      const page = response.result.value
      setValues(previous => next ? [...previous, ...page.exchanges] : page.exchanges)
      setCursor(page.nextCursor)
    }).catch(reason => { if (alive) setError(reason) }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [client, open, next, revision])
  const refresh = () => { setNext(''); setRevision(value => value + 1) }
  return <>
    <Button className={styles.trigger} type="text" icon={<FolderOpen size={16} />} aria-expanded={open} onClick={() => setOpen(true)}>{copy.retainedFiles}</Button>
    <Drawer open={open} title={<div className={styles.heading}><span className={styles.mark}><FolderOpen size={17} /></span><strong>{copy.retainedFiles}</strong></div>}
      size="min(680px, 100vw)" destroyOnHidden getContainer={getContainer} rootClassName={styles.root}
      classNames={{ section: styles.panel, header: styles.header, body: styles.body }}
      closable={{ placement: 'end', 'aria-label': copy.close }}
      extra={!selected && <Tooltip title={copy.refresh}><Button type="text" aria-label={copy.refresh} loading={loading} icon={<RefreshCw size={15} />} onClick={refresh} /></Tooltip>}
      onClose={() => { setOpen(false); setSelected(undefined); setNext('') }}>
      <div className={styles.notice}><Clock3 size={15} /><p>{copy.retainedFilesHint}</p></div>
      {selected ? <>
        <div className={styles.navigation}><Button type="text" size="small" icon={<ArrowLeft size={14} />} onClick={() => setSelected(undefined)}>{copy.backToRetainedFiles}</Button><strong title={selected.name}>{selected.name}</strong></div>
        <div className={styles.browser}><RemoteFiles key={`${selected.id}:${selected.resourceGeneration}`} client={client} exchange={selected} copy={copy} roots={[]} operations={[]} localTasks={localTasks} changed={changed} /></div>
      </> : <div className={styles.content}>
        {error ? <RemoteFeedback message={remoteErrorText(copy, error)} action={<Button size="small" disabled={loading} onClick={refresh}>{copy.retry}</Button>} /> : null}
        {!values.length ? loading ? <div className={styles.state} role="status"><Spin /><p>{copy.retainedFiles}</p></div>
          : !error ? <div className={styles.state}><span className={styles['empty-mark']}><FolderOpen size={28} strokeWidth={1.5} /></span><h2>{copy.retainedFilesEmpty}</h2><p>{copy.retainedFilesEmptyHint}</p></div> : null
          : <div className={styles.list} role="list" aria-label={copy.retainedFiles} aria-busy={loading}>
            {values.map(item => <div role="listitem" key={item.id}><button type="button" className={styles.record} aria-label={`${copy.browseFiles} · ${item.name}`} onClick={() => setSelected(item)}>
              <span className={styles['record-icon']}><FolderOpen size={19} /></span><span className={styles['record-copy']}><strong title={item.name}>{item.name}</strong><span><Clock3 size={12} />{copy.expires} {expiry(item.expiresUnixMs)}</span></span><ChevronRight size={16} className={styles.chevron} />
            </button></div>)}
          </div>}
        {cursor ? <Button className={styles.more} loading={loading} onClick={() => setNext(cursor)}>{copy.loadMore}</Button> : null}
      </div>}
    </Drawer>
  </>
}
