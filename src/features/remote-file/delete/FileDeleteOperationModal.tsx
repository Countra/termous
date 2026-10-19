import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Modal, Table } from 'antd'
import { Check, CircleSlash, CircleX, Clock3, LoaderCircle, Trash2, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { FileOperationTask } from '#entities/file'
import { confirmDialogStyles, modalSurfaceStyles } from '#shared/ui'
import type { FileOperationGateway } from '../model/fileOperationGateway'
import { isFileOperationTerminal, observeFileOperation } from '../model/observeFileOperation'
import styles from './FileDeleteOperationModal.module.scss'

interface DeleteResult {
  items: { path: string; status: 'deleted' | 'failed' | 'not_executed' | 'uncertain'; message?: string }[]
  summary: { total: number; deleted: number; failed: number; not_executed: number; uncertain: number }
  deleted_items: number
  partial: boolean
  uncertain: boolean
}

interface Props {
  count: number
  api: FileOperationGateway
  onStart: () => Promise<FileOperationTask>
  onClose: () => void
  onFinished: (task: FileOperationTask) => void
}

// 提交只发生在用户确认时；查询断线只恢复观察，不重放删除请求。
export function FileDeleteOperationModal({ count, api, onStart, onClose, onFinished }: Props) {
  const { t } = useTranslation()
  const [initialTask, setInitialTask] = useState<FileOperationTask | null>(null)
  const [task, setTask] = useState<FileOperationTask | null>(null)
  const [result, setResult] = useState<DeleteResult | null>(null)
  const [resultFailed, setResultFailed] = useState(false)
  const [error, setError] = useState('')
  const [observationError, setObservationError] = useState<Error | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submissionUncertain, setSubmissionUncertain] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const pending = useRef(false)
  const cancelPending = useRef(false)
  const onFinishedRef = useRef(onFinished)
  useEffect(() => { onFinishedRef.current = onFinished }, [onFinished])

  useEffect(() => {
    if (!initialTask) return
    let disposed = false
    const observation = observeFileOperation({ api, initialTask, onTask: setTask, onObservationError: setObservationError })
    void observation.terminal.then(async (terminal) => {
      if (!terminal || disposed) return
      onFinishedRef.current(terminal)
      const value = await api.fileOperationResult<DeleteResult>(terminal.id)
      if (!disposed) setResult(value)
    }).catch((cause: unknown) => {
      if (!disposed) {
        setResultFailed(true)
        setError(cause instanceof Error ? cause.message : '')
      }
    })
    return () => { disposed = true; observation.dispose() }
  }, [api, initialTask])

  const start = async () => {
    if (pending.current || initialTask || submissionUncertain) return
    pending.current = true
    setSubmitting(true)
    setError('')
    try {
      const created = await onStart()
      setTask(created)
      setInitialTask(created)
    } catch (cause) {
      const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : ''
      setSubmissionUncertain(['REQUEST_TIMEOUT', 'NETWORK_ERROR', 'REQUEST_ABORTED'].includes(String(code)))
      setError(cause instanceof Error ? cause.message : t('files.operationFailed'))
    } finally {
      pending.current = false
      setSubmitting(false)
    }
  }

  const cancel = async () => {
    if (!task?.cancellable || cancelPending.current) return
    cancelPending.current = true
    setCancelling(true)
    setError('')
    try { await api.cancelFileOperation(task.id) }
    catch (cause) {
      cancelPending.current = false
      setCancelling(false)
      setError(cause instanceof Error ? cause.message : t('files.operationFailed'))
    }
  }

  const running = task !== null && !isFileOperationTerminal(task)
  const uncertain = result?.uncertain || task?.error_code === 'SFTP_DELETE_UNCERTAIN'
  const feedback = running ? observationError ? 'observing' : cancelling ? 'cancelling' : 'running'
    : uncertain ? 'uncertain' : task?.status === 'cancelled' ? 'cancelled' : task?.partial ? 'partial'
      : task?.status === 'completed' ? result ? 'done' : resultFailed ? 'unavailable' : 'loading' : 'failed'
  const canClose = !submitting && (!running || observationError !== null)
  const failures = result?.items.filter((item) => item.status === 'failed' || item.status === 'uncertain') ?? []
  const queued = task?.status === 'queued' && !cancelling && !observationError
  const busy = running || feedback === 'loading'
  const Icon = !task ? Trash2 : queued ? Clock3 : busy ? LoaderCircle
    : feedback === 'done' ? Check : feedback === 'cancelled' ? CircleSlash : feedback === 'failed' ? CircleX : TriangleAlert
  const tone = !task || feedback === 'failed' ? 'danger' : feedback === 'done' ? 'success'
    : busy ? 'accent' : feedback === 'cancelled' ? 'neutral' : 'warning'
  const progress = t('files.deletion.progress', { completed: result?.deleted_items ?? task?.completed_items ?? 0 })
  const hint = observationError ? t('files.deletion.reconnecting') : uncertain ? t('files.deletion.uncertain') : ''
  const description = queued ? t('files.deletion.queued', { count }) : [progress, hint].filter(Boolean).join(' · ')
  const notice = submissionUncertain ? t('files.deletion.submissionUncertain')
    : resultFailed ? t('files.move.resultFailed')
      : (!task || running ? error : '') || (!uncertain && failures.length === 0 && task?.status === 'failed' ? task.error_message : '')

  return <Modal open centered width={480} title={t('files.deletion.title')}
    closable={canClose} mask={{ closable: canClose }} keyboard={canClose} onCancel={onClose}
    className={`termous-modal ${confirmDialogStyles.modal} ${styles.modal}`}
    rootClassName={`${confirmDialogStyles['modal-root']} ${modalSurfaceStyles.root} termous-modal-root`}
    footer={task ? [
      running ? <Button key="cancel" loading={cancelling} disabled={!task.cancellable || cancelling} onClick={() => void cancel()}>{t('app.cancel')}</Button> : null,
      <Button key="close" type="primary" disabled={!canClose} onClick={onClose}>{t('files.move.close')}</Button>,
    ] : [
      <Button key="cancel" disabled={submitting} onClick={onClose}>{t('app.cancel')}</Button>,
      <Button key="delete" danger type="primary" loading={submitting} disabled={submissionUncertain} onClick={() => void start()}>{t('app.delete')}</Button>,
    ]}>
    <div className={styles.content}>
      <section className={styles.summary} role="status" aria-live="polite">
        <span className={styles.icon} data-tone={tone}>
          <Icon size={20} aria-hidden="true" className={busy && !queued ? styles.spinning : undefined} />
        </span>
        <div className={styles.copy}>
          <h3>{!task ? t('files.deletion.confirmTitle', { count })
            : queued ? t('files.deletion.waiting') : t(`files.move.feedback.${feedback}`, { action: t('app.delete') })}</h3>
          <p>{task ? description : t('files.deletion.confirmDescription')}</p>
        </div>
      </section>
      {failures.length > 0 ? <Table size="small" className={styles.table} rowKey="path" dataSource={failures}
        pagination={{ pageSize: 5, showSizeChanger: false, hideOnSinglePage: true }} scroll={{ y: 200 }}
        columns={[
          { title: t('files.move.source'), dataIndex: 'path', render: (path: string) => <span className={styles.outcome}>{path}</span> },
          { title: t('files.move.status'), dataIndex: 'message', render: (message: string) => <span className={styles.outcome}>{message}</span> },
        ]} /> : null}
      {notice ? <Alert className={styles.notice} type={submissionUncertain || resultFailed ? 'warning' : 'error'} showIcon title={notice} /> : null}
    </div>
  </Modal>
}
