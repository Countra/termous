import { useCallback, useEffect, useRef, useState } from 'react'
import { App, Breadcrumb, Button, Descriptions, Flex, Input, Modal, Select, Space, Table, Tooltip } from 'antd'
import { ArrowUp, Download, File, Folder, FolderPlus, FolderUp, Info, Laptop, Link, Monitor, Pencil, RefreshCw, Trash2, Upload } from 'lucide-react'
import { RemoteClient, type FileEntry, type FileOperation, type LocalRoot, type Session, type Transfer } from '#entities/remote-control'
import type { RemoteLocalTask } from '#common/contracts'
import { formatBytes } from '#shared/format'
import { RemoteTransferDialog } from './RemoteTransferDialog'
import { remoteErrorText, type RemoteCopy } from '../model/copy'
import styles from './RemoteFiles.module.scss'
import { RemoteFeedback, RemoteFeedbackStack } from './RemoteFeedback'

interface Props { client: RemoteClient; session?: Session; copy: RemoteCopy; roots: LocalRoot[]; operations: FileOperation[]; transfers?: Transfer[]; localTasks?: RemoteLocalTask[]; changed: () => void; exchange?: { id: string; resourceGeneration: bigint; state?: string } }
const join = (parent: string, name: string) => `${parent === '/' ? '' : parent}/${name}`
const parentPath = (value: string) => value.replace(/\/?[^/]+\/?$/, '') || '/'

export function RemoteFiles({ client, session, copy, roots, operations, transfers = [], localTasks = [], changed, exchange }: Props) {
  const { modal } = App.useApp()
  const retained = exchange?.state === 'retained'
  const can = (capability: string) => exchange ? (retained ? ['transfer'] : ['transfer', 'transfer_receive', 'entry_create', 'entry_mutate', 'planned_delete']).includes(capability) : session?.capabilities.includes(capability) === true
  const resourceID = exchange?.id ?? session?.id ?? ''
  const resourceGeneration = exchange?.resourceGeneration ?? session?.generation ?? 0n
  const locationKind = exchange ? 'desktop_exchange' : 'files'
  const [path, setPath] = useState('/')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [cursor, setCursor] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>()
  const [operationPending, setOperationPending] = useState(false)
  const [editing, setEditing] = useState<{ kind: 'mkdir' | 'rename'; entry?: FileEntry }>()
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [details, setDetails] = useState<FileEntry>()
  const [selected, setSelected] = useState<string[]>([])
  const [transfer, setTransfer] = useState<'upload' | 'download'>()
  const [selecting, setSelecting] = useState(false)
  const [overwrite, setOverwrite] = useState<'rename' | 'skip' | 'replace'>('rename')
  const sequence = useRef(0)
  const location = useCallback((target: string) => ({ kind: locationKind, resourceId: resourceID, generation: resourceGeneration, path: target, retained }), [locationKind, resourceID, resourceGeneration, retained])

  const load = useCallback(async (directory: string, next = '') => {
    const request = ++sequence.current
    setLoading(true); setError(undefined)
    try {
      const response = await client.request({ operation: { case: 'file', value: { action: 'list', location: location(directory), cursor: next } } })
      if (request !== sequence.current || response.result.case !== 'directory') return
      const page = response.result.value
      setEntries(previous => next ? [...previous, ...page.entries] : page.entries)
      setCursor(page.nextCursor); setPath(directory); if (!next) setSelected([])
    } catch (reason) { if (request === sequence.current) setError(reason) } finally { if (request === sequence.current) setLoading(false) }
  }, [client, location])
  const cancelReads = useCallback(() => { sequence.current++ }, [])
  useEffect(() => { void load('/'); return cancelReads }, [load, cancelReads])
  const completed = [
    ...operations.filter(task => task.sessionId === session?.id && ['completed', 'failed', 'cancelled', 'uncertain'].includes(task.state)).map(task => `${task.id}:${task.state}`),
    ...transfers.filter(task => task.state === 'completed' && task.target?.kind === locationKind && task.target.resourceId === resourceID).map(task => `transfer:${task.id}`),
    ...localTasks.filter(task => task.state === 'completed' && task.direction === 'upload' && task.session_id === resourceID).map(task => `local:${task.id}`),
  ].sort().join('|')
  const previousCompleted = useRef(completed)
  useEffect(() => {
    // 先完成用户发起的目录导航，再刷新最终所在目录，避免完成事件将页面拉回旧路径。
    if (previousCompleted.current === completed || loading) return
    previousCompleted.current = completed
    void load(path)
  }, [completed, load, path, loading])

  const save = async () => {
    if (!editing || !name.trim() || /[/\\\0]/.test(name) || name === '.' || name === '..') return
    setSaving(true)
    try {
      const targetPath = join(path, name)
      let expectedVersion = ''
      if (editing.entry) {
        const preview = await client.request({ operation: { case: 'file', value: { action: 'preview_rename', location: location(editing.entry.path), targetPath } } })
        if (preview.result.case !== 'preview') throw new Error('remote_preview_invalid')
        expectedVersion = preview.result.value.token
      }
      await client.request({ operation: { case: 'file', value: { operationId: crypto.randomUUID(), action: editing.kind, location: location(editing.entry?.path ?? targetPath), targetPath, expectedVersion } } })
      setEditing(undefined); await load(path)
    } catch (reason) { setError(reason) } finally { setSaving(false) }
  }
  const remove = async (entry: FileEntry) => {
    try {
      const preview = await client.request({ operation: { case: 'file', value: { action: 'preview_delete', location: location(entry.path), recursive: true } } })
      if (preview.result.case !== 'preview') throw new Error('remote_preview_invalid')
      const token = preview.result.value.token
      modal.confirm({ title: copy.deleteTitle, content: <><p>{copy.deleteHint}</p><code>{entry.path}</code></>, okText: copy.remove, cancelText: copy.cancel, okButtonProps: { danger: true }, onOk: async () => {
        try {
          await client.request({ operation: { case: 'file', value: { operationId: crypto.randomUUID(), action: 'delete', location: location(entry.path), recursive: true, expectedVersion: token } } })
          setOperationPending(!exchange)
          changed()
          await load(path)
        } catch (reason) { setError(reason); throw reason }
      } })
    } catch (reason) { setError(reason) }
  }
  const parts = path.split('/').filter(Boolean)
  const selectedEntries = entries.filter(entry => selected.includes(entry.path))
  const selectTransfer = async (direction: 'upload' | 'download', directory = false) => {
    if (selecting || direction === 'download' && !selectedEntries.length) return
    setSelecting(true)
    try {
      const target = location(direction === 'upload' ? path : selectedEntries[0]!.path)
      await client.selectTransfer({ direction, directory, overwrite, name: selectedEntries[0]?.name, location: { ...target, generation: target.generation.toString() }, locations: direction === 'download' ? selectedEntries.map(entry => ({ ...location(entry.path), generation: resourceGeneration.toString() })) : undefined })
      changed()
    } catch (reason) { setError(reason) } finally { setSelecting(false) }
  }
  return <div className={styles.files}>
    <div className={styles['transfer-toolbar']}>
      <div className={styles['transfer-group']} role="group" aria-label={copy.deviceFiles}>
        <span className={styles['transfer-source']}><Laptop size={15} />{copy.deviceFiles}</span>
        <Flex className={styles['transfer-actions']} gap={6} wrap align="center">
          <Button size="small" type="primary" icon={<Upload size={14} />} disabled={selecting || !can('transfer_receive')} onClick={() => void selectTransfer('upload')}>{copy.uploadDevice}</Button>
          <Tooltip title={copy.uploadFolderDevice}><Button size="small" icon={<FolderUp size={14} />} aria-label={copy.uploadFolderDevice} disabled={selecting || !can('transfer_receive') || !can('entry_create')} onClick={() => void selectTransfer('upload', true)} /></Tooltip>
          <Tooltip title={!selectedEntries.length ? copy.transferHint : copy.downloadDevice}><Button size="small" icon={<Download size={14} />} disabled={selecting || !selectedEntries.length || !can('transfer')} onClick={() => void selectTransfer('download')}>{copy.downloadDevice}</Button></Tooltip>
        </Flex>
      </div>
      {!exchange && <div className={styles['transfer-group']} role="group" aria-label={copy.hostFiles}>
        <span className={styles['transfer-source']}><Monitor size={15} />{copy.hostFiles}</span>
        <Flex className={styles['transfer-actions']} gap={6} wrap align="center">
          <Button size="small" icon={<Upload size={14} />} disabled={!can('transfer_receive')} onClick={() => setTransfer('upload')}>{copy.uploadHost}</Button>
          <Button size="small" icon={<Download size={14} />} disabled={!selected.length || !can('transfer')} onClick={() => setTransfer('download')}>{copy.downloadHost}</Button>
        </Flex>
      </div>
      }
      <div className={styles['transfer-options']}><span>{copy.overwrite}</span><Select size="small" aria-label={copy.overwrite} value={overwrite} onChange={setOverwrite} options={[{ value: 'rename', label: copy.autoRename }, { value: 'skip', label: copy.skip }, { value: 'replace', label: copy.replaceFile }]} /></div>
    </div>
    {transfer && session && !exchange ? <RemoteTransferDialog client={client} session={session} copy={copy} roots={roots} upload={transfer === 'upload'} paths={selected} directory={path} close={() => setTransfer(undefined)} changed={changed} /> : null}
    <div className={styles.toolbar}><Space><Button icon={<ArrowUp size={16} />} aria-label={copy.parent} disabled={loading || path === '/'} onClick={() => void load(path === '.' ? '..' : parentPath(path))} /><Breadcrumb items={[{ title: <button className={styles.crumb} onClick={() => void load('/')}>/</button> }, ...parts.map((part, index) => ({ title: <button className={styles.crumb} onClick={() => void load(`${path.startsWith('/') ? '/' : ''}${parts.slice(0, index + 1).join('/')}`)}>{part}</button> }))]} /></Space><Space><Button disabled={!can('entry_create')} icon={<FolderPlus size={16} />} onClick={() => { setName(''); setEditing({ kind: 'mkdir' }) }}>{copy.newFolder}</Button><Button icon={<RefreshCw size={15} />} aria-label={copy.refresh} loading={loading} onClick={() => void load(path)} /></Space></div>
    <div className={styles.table}><Table<FileEntry> rowKey="path" dataSource={entries} scroll={{ x: 580 }} rowSelection={{ selectedRowKeys: selected, onChange: keys => setSelected(keys.map(String)), getCheckboxProps: value => ({ disabled: !['file', 'directory'].includes(value.kind) }) }} loading={loading} pagination={false} size="small" locale={{ emptyText: copy.emptyDirectory }} onRow={entry => ({ onDoubleClick: () => { if (entry.kind === 'directory') void load(entry.path) } })} columns={[
      { title: copy.name, dataIndex: 'name', render: (_, entry) => <button className={styles.entry} onClick={() => entry.kind === 'directory' ? void load(entry.path) : setDetails(entry)}>{entry.kind === 'directory' ? <Folder size={17} /> : entry.kind === 'symlink' ? <Link size={16} /> : <File size={16} />}<span>{entry.name}</span></button> },
      { title: copy.size, width: 90, render: (_, entry) => entry.kind === 'directory' ? '—' : formatBytes(Number(entry.size)) },
      { title: copy.modified, width: 175, render: (_, entry) => Number(entry.modifiedUnixMs) > 0 ? new Date(Number(entry.modifiedUnixMs)).toLocaleString() : '—' },
      { title: '', width: 124, render: (_, entry) => <Space size={0}><Tooltip title={copy.properties}><Button type="text" icon={<Info size={15} />} aria-label={copy.properties} onClick={() => setDetails(entry)} /></Tooltip><Tooltip title={copy.rename}><Button disabled={!can('entry_mutate')} type="text" icon={<Pencil size={15} />} aria-label={copy.rename} onClick={() => { setName(entry.name); setEditing({ kind: 'rename', entry }) }} /></Tooltip><Tooltip title={copy.remove}><Button disabled={!can('planned_delete')} type="text" danger icon={<Trash2 size={15} />} aria-label={copy.remove} onClick={() => void remove(entry)} /></Tooltip></Space> },
    ]} />{cursor ? <Button block loading={loading} onClick={() => void load(path, cursor)}>{copy.loadMore}</Button> : null}</div>
    <RemoteFeedbackStack>
      {error && !editing ? <RemoteFeedback message={remoteErrorText(copy, error)} closeLabel={copy.close} onClose={() => setError(undefined)} /> : null}
      {operationPending ? <RemoteFeedback tone="info" message={copy.operationPending} closeLabel={copy.close} onClose={() => setOperationPending(false)} /> : null}
    </RemoteFeedbackStack>
    <Modal title={editing?.kind === 'mkdir' ? copy.newFolder : copy.rename} open={Boolean(editing)} onCancel={() => setEditing(undefined)} onOk={() => void save()} confirmLoading={saving} okText={copy.save} cancelText={copy.cancel} okButtonProps={{ disabled: !name.trim() || /[/\\\0]/.test(name) || name === '.' || name === '..' }}><Flex vertical gap={12}><Input autoFocus aria-label={copy.name} value={name} onChange={event => setName(event.target.value)} onPressEnter={() => void save()} />{error ? <RemoteFeedback message={remoteErrorText(copy, error)} closeLabel={copy.close} onClose={() => setError(undefined)} /> : null}</Flex></Modal>
    <Modal title={copy.properties} open={Boolean(details)} footer={null} onCancel={() => setDetails(undefined)}>{details ? <Descriptions column={1} items={[{ key: 'name', label: copy.name, children: details.name }, { key: 'path', label: copy.path, children: details.path }, { key: 'size', label: copy.size, children: details.size.toString() }, ...(can('permission_edit') ? [{ key: 'permissions', label: copy.permissions, children: details.permissions.toString(8) }] : [])]} /> : null}</Modal>
  </div>
}
