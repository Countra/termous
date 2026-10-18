import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Flex, Modal, Select, Table, Typography } from 'antd'
import { ArrowUp, File, Folder } from 'lucide-react'
import { RemoteClient, type FileEntry, type LocalRoot, type Session } from '#entities/remote-control'
import { remoteErrorText, type RemoteCopy } from '../model/copy'
import { RemoteFeedback } from './RemoteFeedback'
import listStyles from './RemoteFileList.module.scss'
import styles from './RemoteTransferDialog.module.scss'

interface Props {
  client: RemoteClient; session: Session; roots: LocalRoot[]; copy: RemoteCopy
  upload: boolean; paths: string[]; directory: string; close: () => void; changed: () => void
}

export function RemoteTransferDialog({ client, session, roots, copy, upload, paths, directory, close, changed }: Props) {
  const allowed = roots.filter(root => upload ? root.readable : root.writable)
  const [selectedRoot, setRoot] = useState(allowed[0]?.id ?? '')
  const root = allowed.some(value => value.id === selectedRoot) ? selectedRoot : allowed[0]?.id ?? ''
  const [path, setPath] = useState('.')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [cursor, setCursor] = useState('')
  const [overwrite, setOverwrite] = useState('rename')
  const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<{ operation: 'read' | 'transfer'; reason: unknown }>()
  const sequence = useRef(0)
  const load = useCallback(async (next: string, cursor = '') => {
    if (!root) return
    const current = ++sequence.current
    setReading(true); setError(undefined)
    try {
      const response = await client.request({ operation: { case: 'file', value: { action: 'list', location: { kind: 'host_local', resourceId: root, path: next }, cursor } } })
      if (current !== sequence.current) return
      if (response.result.case !== 'directory') throw new Error('remote_invalid_response')
      const value = response.result.value
      setEntries(previous => cursor ? [...previous, ...value.entries] : value.entries)
      setCursor(value.nextCursor); setPath(next); setSelected([])
    } catch (reason) { if (current === sequence.current) setError({ operation: 'read', reason }) } finally { if (current === sequence.current) setReading(false) }
  }, [client, root])
  const cancelReads = useCallback(() => { sequence.current++ }, [])
  useEffect(() => {
    // 授权目录或客户端变化后清空旧选择，读取失败也不能沿用其他目录的文件。
    setPath('.'); setEntries([]); setSelected([]); setCursor(''); setError(undefined); setReading(false)
    void load('.')
    return cancelReads
  }, [load, cancelReads])
  const start = async () => {
    if (busy || reading || !root || upload && !selected.length) return
    setBusy(true); setError(undefined)
    const remote = (path: string) => ({ kind: 'files', resourceId: session.id, generation: session.generation, path })
    const host = (path: string) => ({ kind: 'host_local', resourceId: root, path })
    try {
      await client.request({ operation: { case: 'transfer', value: { action: 'create', operationId: crypto.randomUUID(), overwrite, sources: upload ? selected.map(host) : paths.map(remote), target: upload ? remote(directory) : host(path) } } })
      changed(); close()
    } catch (reason) { setError({ operation: 'transfer', reason }) } finally { setBusy(false) }
  }
  return <Modal title={upload ? copy.uploadHost : copy.downloadHost} open onCancel={close} onOk={() => void start()} confirmLoading={busy} okText={copy.startTransfer} cancelText={copy.cancel} okButtonProps={{ disabled: !root || reading || upload && !selected.length }} width={640}>
    <Flex vertical gap={12}>
      <Typography.Text type="secondary">{copy.executeHost}</Typography.Text>
      {!allowed.length ? <RemoteFeedback tone="info" message={copy.noRoots} /> : <>
        <Select aria-label={copy.chooseFolder} value={root} onChange={setRoot} disabled={busy} options={allowed.map(value => ({ value: value.id, label: value.name }))} />
        <Flex align="center" gap={12}><Button aria-label={copy.parent} icon={<ArrowUp size={16} />} disabled={reading || path === '.' || busy} onClick={() => void load(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.')} /><Typography.Text code>{path}</Typography.Text></Flex>
        <Table<FileEntry> className={listStyles.list} rowKey="path" size="small" tableLayout="fixed" loading={reading} pagination={false} locale={{ emptyText: copy.emptyDirectory }} scroll={{ y: 260 }} dataSource={entries} rowSelection={upload ? { selectedRowKeys: selected, onChange: keys => setSelected(keys.map(String)), getCheckboxProps: value => ({ disabled: busy || !['file', 'directory'].includes(value.kind) }) } : undefined} columns={[{ title: upload ? copy.chooseSource : copy.chooseFolder, key: 'name', render: (_, value) => value.kind === 'directory' ? <button className={listStyles.entry} data-directory="true" title={value.name} onClick={() => void load(value.path)}><Folder size={16} /><span>{value.name}</span></button> : <span className={listStyles.entry} title={value.name}><File size={16} /><span>{value.name}</span></span> }]} />
        {cursor ? <Button loading={reading} onClick={() => void load(path, cursor)}>{copy.loadMore}</Button> : null}
        <div className={styles.options}><span>{copy.overwrite}</span><Select aria-label={copy.overwrite} value={overwrite} onChange={setOverwrite} options={[{ value: 'rename', label: copy.autoRename }, { value: 'skip', label: copy.skip }, { value: 'replace', label: copy.replaceFile }]} /></div>
      </>}
      {error ? <RemoteFeedback message={remoteErrorText(copy, error.reason)} closeLabel={copy.close} onClose={() => setError(undefined)} action={error.operation === 'read' ? <Button size="small" disabled={reading || busy} onClick={() => void load(path)}>{copy.retry}</Button> : undefined} /> : null}
    </Flex>
  </Modal>
}
