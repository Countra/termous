import { useState } from 'react'
import { Alert, Button, Flex, Progress, Typography } from 'antd'
import { Trash2, X } from 'lucide-react'
import { RemoteClient, type FileOperation, type Session } from '#entities/remote-control'
import { remoteErrorText, type RemoteCopy } from '../model/copy'

export function RemoteOperations({ client, operations, sessions, copy, changed }: { client: RemoteClient; operations: FileOperation[]; sessions: Session[]; copy: RemoteCopy; changed: () => void }) {
  const [error, setError] = useState<unknown>()
  const cancel = async (task: FileOperation) => {
    const session = sessions.find(item => item.id === task.sessionId)
    if (!session) return
    try {
      await client.request({ operation: { case: 'file', value: { action: 'operation_cancel', taskId: task.id, location: { kind: 'files', resourceId: session.id, generation: session.generation, path: '/' } } } })
      changed()
    } catch (reason) { setError(reason) }
  }
  const status = (value: string) => ({ queued: copy.queued, running: copy.running, completed: copy.completed, failed: copy.failed, cancelled: copy.cancelled, uncertain: copy.uncertain })[value] ?? copy.unknown
  return <>
    {error ? <Alert type="warning" title={remoteErrorText(copy, error)} /> : null}
    {operations.map(task => <Flex key={task.id} align="center" gap={12}><Trash2 size={17} /><Flex flex={1} vertical><Typography.Text ellipsis>{copy.remove} · {task.path}</Typography.Text><Typography.Text type="secondary">{status(task.state)} · {task.completedEntries.toString()} / {task.totalEntries.toString()}</Typography.Text><Progress size="small" percent={task.state === 'completed' ? 100 : task.totalEntries > 0 ? Math.min(100, Number(task.completedEntries * 100n / task.totalEntries)) : 0} status={['failed', 'uncertain'].includes(task.state) ? 'exception' : undefined} /></Flex>{['queued', 'running'].includes(task.state) ? <Button type="text" aria-label={copy.cancel} icon={<X size={16} />} onClick={() => void cancel(task)} /> : null}</Flex>)}
  </>
}
