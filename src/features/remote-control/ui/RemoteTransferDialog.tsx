import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Flex, Modal, Select, Table, Typography } from 'antd'
import { ArrowUp, Folder } from 'lucide-react'
import { RemoteClient, type FileEntry, type LocalRoot, type Session } from '#entities/remote-control'
import { remoteErrorText, type RemoteCopy } from '../model/copy'

interface Props {
  client: RemoteClient; session: Session; roots: LocalRoot[]; copy: RemoteCopy
  upload: boolean; paths: string[]; directory: string; close: () => void; changed: () => void
}

export function RemoteTransferDialog({ client, session, roots, copy, upload, paths, directory, close, changed }: Props) {
  const allowed = roots.filter(root => upload ? root.readable : root.writable)
  const [root, setRoot] = useState(allowed[0]?.id ?? '')
  const [path, setPath] = useState('.')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [cursor, setCursor] = useState('')
  const [overwrite, setOverwrite] = useState('rename')
  const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<unknown>()
  const sequence = useRef(0)
  const load = useCallback(async (next: string, cursor = '') => {
    if (!root) return
    const current = ++sequence.current
    setReading(true)
    try {
      const response = await client.request({ operation: { case: 'file', value: { action: 'list', location: { kind: 'host_local', resourceId: root, path: next }, cursor } } })
      if (current !== sequence.current || response.result.case !== 'directory') return
      const value = response.result.value
      setEntries(previous => cursor ? [...previous, ...value.entries] : value.entries)
      setCursor(value.nextCursor); setPath(next); setSelected([])
    } catch (e) { if (current === sequence.current) setError(e) } finally { if (current === sequence.current) setReading(false) }
  }, [client, root])
  const cancelReads = useCallback(() => { sequence.current++ }, [])
  useEffect(() => { void load('.'); return cancelReads }, [load, cancelReads])
  const start = async () => {
    if (busy || !root || upload && !selected.length) return
    setBusy(true); setError(undefined)
    const remote = (path: string) => ({ kind: 'files', resourceId: session.id, generation: session.generation, path })
    const host = (path: string) => ({ kind: 'host_local', resourceId: root, path })
    try {
      await client.request({ operation: { case: 'transfer', value: { action: 'create', operationId: crypto.randomUUID(), overwrite, sources: upload ? selected.map(host) : paths.map(remote), target: upload ? remote(directory) : host(path) } } })
      changed(); close()
    } catch (e) { setError(e) } finally { setBusy(false) }
  }
  return <Modal title={upload ? copy.uploadHost : copy.downloadHost} open onCancel={close} onOk={() => void start()} confirmLoading={busy} okText={copy.startTransfer} cancelText={copy.cancel} okButtonProps={{ disabled: !root || reading || upload && !selected.length }} width={640}>
    <Flex vertical gap={12}>
      <Typography.Text type="secondary">{copy.executeHost}</Typography.Text>
      {error ? <Alert type="warning" title={remoteErrorText(copy, error)} /> : null}
      {!allowed.length ? <Alert type="info" title={copy.noRoots} /> : <>
        <Select aria-label={copy.chooseFolder} value={root} onChange={setRoot} disabled={busy} options={allowed.map(value => ({ value: value.id, label: value.name }))} />
        <Flex align="center" gap={12}><Button aria-label={copy.parent} icon={<ArrowUp size={16} />} disabled={reading || path === '.' || busy} onClick={() => void load(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.')} /><Typography.Text code>{path}</Typography.Text></Flex>
        <Table<FileEntry> rowKey="path" size="small" loading={reading} pagination={false} scroll={{ y: 260 }} dataSource={entries} rowSelection={upload ? { selectedRowKeys: selected, onChange: keys => setSelected(keys.map(String)), getCheckboxProps: value => ({ disabled: busy || !['file', 'directory'].includes(value.kind) }) } : undefined} columns={[{ title: upload ? copy.chooseSource : copy.chooseFolder, key: 'name', render: (_, value) => value.kind === 'directory' ? <Button type="text" icon={<Folder size={16} />} onClick={() => void load(value.path)}>{value.name}</Button> : <Typography.Text type={upload ? undefined : 'secondary'}>{value.name}</Typography.Text> }]} />
        {cursor ? <Button loading={reading} onClick={() => void load(path, cursor)}>{copy.loadMore}</Button> : null}
        <Flex align="center" justify="space-between"><span>{copy.overwrite}</span><Select aria-label={copy.overwrite} value={overwrite} onChange={setOverwrite} options={[{ value: 'rename', label: copy.autoRename }, { value: 'skip', label: copy.skip }, { value: 'replace', label: copy.replaceFile }]} /></Flex>
      </>}
    </Flex>
  </Modal>
}
