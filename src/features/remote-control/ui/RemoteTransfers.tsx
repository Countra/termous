import { useState } from 'react'
import { Button, Collapse, Flex, Progress, Typography } from 'antd'
import { ArrowDownUp, Monitor, Play, Upload, Download, X } from 'lucide-react'
import type { RemoteLocalTask } from '#common/contracts'
import { RemoteClient, type Transfer, type FileOperation, type Session } from '#entities/remote-control'
import { remoteErrorText, type RemoteCopy } from '../model/copy'
import { RemoteOperations } from './RemoteOperations'
import { transferPercent, uploadStage } from '../model/transferProgress'
import styles from './RemoteTransfers.module.scss'
import { RemoteFeedback } from './RemoteFeedback'

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
  const allTasks = [...remoteTasks, ...localTasks, ...operations]
  const active = allTasks.filter(task => ['queued', 'running', 'preparing', 'received', 'publishing', 'paused'].includes(task.state)).length
  return <Collapse className={styles.transfers} size="small" ghost items={[{ key: 'transfers', label: <div className={styles.summary}><ArrowDownUp size={14} /><span>{copy.taskCenter}</span><span className={styles.count}>{allTasks.length}</span>{active ? <span className={styles.activity}>{active} {copy.activeTasks}</span> : null}</div>, children: <Flex className={styles.list} vertical gap={12}>
    {!remoteTasks.length && !localTasks.length && !operations.length ? <Typography.Text type="secondary">{copy.noTasks}</Typography.Text> : null}
    <RemoteOperations client={client} operations={operations} sessions={sessions} copy={copy} changed={changed} />
    {remoteTasks.map(task => {
      const upload = task.execution === 'controller' && task.source?.kind === 'controller_local'
      const active = ['running', 'received', 'publishing'].includes(task.state)
      const label = upload && active ? copy[uploadStage(task.state, Number(task.totalBytes), Number(task.targetBytes))] : status(task.state)
      return <Flex key={task.id} gap={12} align="center"><Monitor size={17} /><Flex flex={1} vertical><Typography.Text ellipsis>{task.currentFile || task.source?.path} → {task.target?.path}</Typography.Text><Typography.Text type="secondary">{task.execution === 'controller' ? copy.executeDevice : copy.executeHost} · {label}</Typography.Text><Progress size="small" percent={transferPercent(task.state, Number(task.totalBytes), Number(task.confirmedBytes), upload ? Number(task.targetBytes) : undefined)} status={['failed', 'uncertain', 'interrupted'].includes(task.state) ? 'exception' : undefined} /></Flex>{active || task.state === 'queued' ? <Button aria-label={copy.cancel} type="text" icon={<X size={16} />} onClick={() => void cancel(task)} /> : null}</Flex>
    })}
    {localTasks.map(task => {
      const upload = task.direction === 'upload'
      const label = upload && task.state === 'running' ? copy[uploadStage(task.stage ?? '', task.total_bytes, task.target_bytes ?? 0)] : status(task.state)
      return <Flex key={task.id} gap={12} align="center">{upload ? <Upload size={17} /> : <Download size={17} />}<Flex flex={1} vertical><Typography.Text ellipsis>{task.name}</Typography.Text><Typography.Text type="secondary">{upload ? copy.uploadDevice : copy.downloadDevice} · {label}</Typography.Text><Progress size="small" percent={transferPercent(task.state, task.total_bytes, task.confirmed_bytes, upload ? task.target_bytes ?? 0 : undefined)} status={['failed', 'uncertain'].includes(task.state) ? 'exception' : undefined} /></Flex>{task.resumable ? <Button disabled={!!busy} icon={<Play size={15} />} onClick={() => void localAction(task, 'resume')}>{copy.resume}</Button> : null}{['running', 'paused', 'preparing'].includes(task.state) ? <Button disabled={!!busy} aria-label={copy.cancel} type="text" icon={<X size={16} />} onClick={() => void localAction(task, 'cancel')} /> : null}</Flex>
    })}
    {error ? <RemoteFeedback message={remoteErrorText(copy, error)} closeLabel={copy.close} onClose={() => setError(undefined)} /> : null}
  </Flex> }]} />
}
