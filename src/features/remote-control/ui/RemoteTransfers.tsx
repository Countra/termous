import { useState } from 'react'
import { Alert, Button, Collapse, Flex, Progress, Typography } from 'antd'
import { Monitor, Play, Upload, Download, X } from 'lucide-react'
import type { RemoteLocalTask } from '#common/contracts'
import { RemoteClient, type Transfer, type FileOperation, type Session } from '#entities/remote-control'
import { remoteErrorText, type RemoteCopy } from '../model/copy'
import { RemoteOperations } from './RemoteOperations'

export function RemoteTransfers({ client, tasks, localTasks, operations, sessions, copy, changed }: { client: RemoteClient; tasks: Transfer[]; localTasks: RemoteLocalTask[]; operations: FileOperation[]; sessions: Session[]; copy: RemoteCopy; changed: () => void }) {
  const [error, setError] = useState<unknown>()
  const [busy, setBusy] = useState<string>()
  const cancel = async (task: Transfer) => {
    try { await client.request({ operation: { case: 'transfer', value: { action: 'cancel', transferId: task.id } } }); changed() } catch (e) { setError(e) }
  }
  const localAction = async (task: RemoteLocalTask, action: 'resume' | 'cancel') => {
    if (busy) return
    setBusy(task.id)
    try { await client.localTransferAction(task.id, action); changed() } catch (e) { setError(e) } finally { setBusy(undefined) }
  }
  const status = (value: string) => ({ queued: copy.queued, running: copy.running, completed: copy.completed, failed: copy.failed, cancelled: copy.cancelled, interrupted: copy.interrupted, uncertain: copy.uncertain, paused: copy.paused, preparing: copy.preparing, publishing: copy.publishing, published: copy.publishing, received: copy.publishing, ready: copy.preparing })[value] ?? copy.unknown
  const remoteTasks = tasks.filter(task => !localTasks.some(local => local.remote_id === task.id))
  return <Collapse size="small" ghost items={[{ key: 'transfers', label: `${copy.tasks} · ${remoteTasks.length + localTasks.length + operations.length}`, children: <Flex vertical gap={12} style={{ maxHeight: 230, overflow: 'auto' }}>
    {error ? <Alert type="warning" title={remoteErrorText(copy, error)} /> : null}
    {!remoteTasks.length && !localTasks.length && !operations.length ? <Typography.Text type="secondary">{copy.noTasks}</Typography.Text> : null}
    <RemoteOperations client={client} operations={operations} sessions={sessions} copy={copy} changed={changed} />
    {remoteTasks.map(task => <Flex key={task.id} gap={12} align="center"><Monitor size={17} /><Flex flex={1} vertical><Typography.Text ellipsis>{task.currentFile || task.source?.path} → {task.target?.path}</Typography.Text><Typography.Text type="secondary">{task.execution === 'controller' ? copy.executeDevice : copy.executeHost} · {status(task.state)}</Typography.Text><Progress size="small" percent={task.state === 'completed' ? 100 : task.totalBytes > 0 ? Math.min(100, Number(task.confirmedBytes * 100n / task.totalBytes)) : 0} status={['failed', 'uncertain', 'interrupted'].includes(task.state) ? 'exception' : undefined} /></Flex>{['running', 'queued'].includes(task.state) ? <Button aria-label={copy.cancel} type="text" icon={<X size={16} />} onClick={() => void cancel(task)} /> : null}</Flex>)}
    {localTasks.map(task => <Flex key={task.id} gap={12} align="center">{task.direction === 'upload' ? <Upload size={17} /> : <Download size={17} />}<Flex flex={1} vertical><Typography.Text ellipsis>{task.name}</Typography.Text><Typography.Text type="secondary">{task.direction === 'upload' ? copy.uploadDevice : copy.downloadDevice} · {status(task.state)}</Typography.Text><Progress size="small" percent={task.state === 'completed' ? 100 : task.total_bytes > 0 ? Math.min(100, Math.floor(task.confirmed_bytes * 100 / task.total_bytes)) : 0} status={['failed', 'uncertain'].includes(task.state) ? 'exception' : undefined} /></Flex>{task.resumable ? <Button disabled={!!busy} icon={<Play size={15} />} onClick={() => void localAction(task, 'resume')}>{copy.resume}</Button> : null}{['running', 'paused', 'preparing'].includes(task.state) ? <Button disabled={!!busy} aria-label={copy.cancel} type="text" icon={<X size={16} />} onClick={() => void localAction(task, 'cancel')} /> : null}</Flex>)}
  </Flex> }]} />
}
