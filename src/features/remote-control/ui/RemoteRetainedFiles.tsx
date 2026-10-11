import { useEffect, useState } from 'react'
import { Button, Drawer, Empty, List, Space, Spin } from 'antd'
import { FolderOpen, RefreshCw } from 'lucide-react'
import type { DesktopExchange } from '@termous/remote-protocol/desktop'
import type { RemoteClient } from '#entities/remote-control'
import type { RemoteLocalTask } from '#common/contracts'
import { formatDate } from '#shared/format'
import { type RemoteCopy, remoteErrorText } from '../model/copy'
import { RemoteFeedback } from './RemoteFeedback'
import { RemoteFiles } from './RemoteFiles'

export function RemoteRetainedFiles({ client, copy, localTasks, changed }: { client: RemoteClient; copy: RemoteCopy; localTasks?: RemoteLocalTask[]; changed(): void }) {
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
  return <>
    <Button type="text" icon={<FolderOpen size={16} />} onClick={() => setOpen(true)}>{copy.retainedFiles}</Button>
    <Drawer open={open} title={copy.retainedFiles} size={760} destroyOnHidden onClose={() => { setOpen(false); setSelected(undefined); setNext('') }}>
      <p>{copy.retainedFilesHint}</p>
      {error ? <RemoteFeedback message={remoteErrorText(copy, error)} /> : null}
      {selected ? <><Button onClick={() => setSelected(undefined)}>{copy.retainedFiles}</Button><RemoteFiles key={selected.id} client={client} exchange={selected} copy={copy} roots={[]} operations={[]} localTasks={localTasks} changed={changed} /></> : <>
        <Button icon={<RefreshCw size={14} />} disabled={loading} onClick={() => { setNext(''); setRevision(value => value + 1) }}>{copy.refresh}</Button>
        <List dataSource={values} locale={{ emptyText: loading ? <Spin /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} /> }} renderItem={item => <List.Item key={item.id} actions={[<Button key="claim" onClick={() => setSelected(item)}>{copy.downloadDevice}</Button>]}><Space orientation="vertical"><strong>{item.name}</strong><span>{formatDate(new Date(Number(item.expiresUnixMs)).toISOString())}</span></Space></List.Item>} />
        {cursor ? <Button disabled={loading} onClick={() => setNext(cursor)}>{copy.loadMore}</Button> : null}
      </>}
    </Drawer>
  </>
}
