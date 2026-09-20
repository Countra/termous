import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Modal, Progress, Table } from 'antd'
import { useTranslation } from 'react-i18next'
import type { FileMoveResult, FileOperationTask } from '#entities/file'
import { confirmDialogStyles } from '#shared/ui'
import type { FileOperationGateway } from '../model/fileOperationGateway.ts'
import { isFileOperationTerminal, observeFileOperation } from '../model/observeFileOperation.ts'
import styles from './FileMoveOperationModal.module.scss'

interface Props {
  initialTask: FileOperationTask
  api: FileOperationGateway
  onClose: () => void
  onFinished: (task: FileOperationTask) => void
}

// 所有引擎共享任务视图，创建请求由动作入口提交，组件挂载不会重放修改。
export function FileMoveOperationModal({ initialTask, api, onClose, onFinished }: Props) {
  const { t } = useTranslation()
  const [task, setTask] = useState(initialTask)
  const [result, setResult] = useState<FileMoveResult | null>(null)
  const [error, setError] = useState('')
  const [resultFailed, setResultFailed] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const cancelPending = useRef(false)
  const onFinishedRef = useRef(onFinished)
  useEffect(() => { onFinishedRef.current = onFinished }, [onFinished])
  useEffect(() => {
    let disposed = false
    const observation = observeFileOperation({ api, initialTask, onTask: setTask })
    void observation.terminal.then(async (terminal) => {
      if (!terminal || disposed) return
      onFinishedRef.current(terminal)
      const value = await api.fileOperationResult<FileMoveResult>(terminal.id)
      if (!disposed) setResult(value)
    }).catch((cause: unknown) => {
      if (!disposed) {
        setResultFailed(true)
        setError(cause instanceof Error ? cause.message : '')
      }
    })
    return () => { disposed = true; observation.dispose() }
  }, [api, initialTask])
  const running = !isFileOperationTerminal(task)
  const cancel = async () => {
    if (cancelPending.current || !running || !task.cancellable) return
    cancelPending.current = true
    setCancelling(true)
    try { await api.cancelFileOperation(task.id) }
    catch (cause) {
      cancelPending.current = false
      setCancelling(false)
      setError(cause instanceof Error ? cause.message : t('files.operationFailed'))
    }
  }
  const resultStatus = !result && !resultFailed
    ? 'files.move.loadingResult'
    : task.status === 'completed' && !task.partial && !result?.partial && !resultFailed
      ? 'files.move.done'
      : 'files.move.incomplete'
  return (
    <Modal open centered width={820} title={t('files.move.title')} closable={!running} mask={{ closable: !running }} keyboard={!running} onCancel={onClose}
      className={`termous-modal ${styles.modal}`} rootClassName={`${confirmDialogStyles['modal-root']} termous-modal-root`}
      footer={[
        running ? <Button key="cancel" loading={cancelling} disabled={!task.cancellable || cancelling} onClick={() => void cancel()}>{t(cancelling ? 'files.move.cancelling' : 'app.cancel')}</Button> : null,
        <Button key="close" disabled={running} onClick={onClose}>{t('files.move.close')}</Button>,
      ]}>
      <div className={styles.content}>
        {result?.non_atomic ? <Alert type="warning" showIcon title={t('files.move.nonAtomic')} /> : null}
        {resultFailed || error ? <Alert type="error" showIcon title={error || t('files.move.resultFailed')} /> : null}
        {task.error_message ? <Alert type="error" showIcon title={task.error_message} /> : null}
        <Progress percent={Math.round(task.progress_percent)} status={task.status === 'failed' || task.status === 'cancelled' ? 'exception' : task.status === 'completed' ? 'success' : 'active'} />
        <p className={styles.status} role="status">{running ? task.phase_label : t(resultStatus)}</p>
        {result ? <Table size="small" rowKey={(row) => row.source_path} dataSource={result.items} pagination={{ pageSize: 20, showSizeChanger: false, hideOnSinglePage: true }} scroll={{ x: 620, y: 280 }}
          columns={[
            { title: t('files.move.source'), dataIndex: 'source_path', ellipsis: true },
            { title: t('files.move.target'), dataIndex: 'target_path', ellipsis: true },
            { title: t('files.move.status'), dataIndex: 'status', width: 210, render: (status: string, item) => <div className={styles.outcome}><span>{t(`files.move.statuses.${status}`)}</span>{item.message ? <small>{item.message}</small> : null}</div> },
          ]} /> : null}
      </div>
    </Modal>
  )
}
