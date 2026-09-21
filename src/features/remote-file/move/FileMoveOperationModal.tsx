import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Modal, Progress, Table, Tooltip } from 'antd'
import { Check, CircleSlash, LoaderCircle, TriangleAlert, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { FileMoveResult, FileOperationTask } from '#entities/file'
import { parentPath, pathBase } from '#shared/path'
import { confirmDialogStyles } from '#shared/ui'
import type { FileOperationGateway } from '../model/fileOperationGateway.ts'
import { isFileOperationTerminal, observeFileOperation } from '../model/observeFileOperation.ts'
import styles from './FileMoveOperationModal.module.scss'

interface Props {
  initialTask: FileOperationTask
  rename?: { sourcePath: string; targetPath: string }
  api: FileOperationGateway
  onClose: () => void
  onFinished: (task: FileOperationTask) => void
}

// 所有引擎共享任务视图，创建请求由动作入口提交，组件挂载不会重放修改。
export function FileMoveOperationModal({ initialTask, rename, api, onClose, onFinished }: Props) {
  const { t } = useTranslation()
  const [task, setTask] = useState(initialTask)
  const [result, setResult] = useState<FileMoveResult | null>(null)
  const [error, setError] = useState('')
  const [observationError, setObservationError] = useState<Error | null>(null)
  const [resultFailed, setResultFailed] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const cancelPending = useRef(false)
  const onFinishedRef = useRef(onFinished)
  useEffect(() => { onFinishedRef.current = onFinished }, [onFinished])
  useEffect(() => {
    let disposed = false
    const observation = observeFileOperation({ api, initialTask, onTask: setTask, onObservationError: setObservationError })
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
  const canClose = !running || observationError !== null
  const cancel = async () => {
    if (cancelPending.current || !running || !task.cancellable) return
    cancelPending.current = true
    setCancelling(true)
    setError('')
    try { await api.cancelFileOperation(task.id) }
    catch (cause) {
      cancelPending.current = false
      setCancelling(false)
      setError(cause instanceof Error && cause.message.trim() ? cause.message : t('files.operationFailed'))
    }
  }
  const action = t(rename ? 'files.rename' : 'files.move.action')
  const uncertain = result?.uncertain || task.error_code === 'SFTP_RENAME_UNCERTAIN'
  const partial = task.partial || result?.partial
  const feedback = running
    ? observationError ? 'observing' : cancelling ? 'cancelling' : 'running'
    : uncertain ? 'uncertain'
      : partial ? 'partial'
        : task.status === 'cancelled' ? 'cancelled'
          : task.status === 'failed' ? 'failed'
            : !result ? resultFailed ? 'unavailable' : 'loading'
              : 'done'
  const tone = feedback === 'failed' ? 'danger'
    : ['uncertain', 'partial', 'observing', 'unavailable'].includes(feedback) ? 'warning'
      : feedback === 'done' ? 'success' : feedback === 'cancelled' ? 'muted' : 'accent'
  const Icon = tone === 'danger' ? X : tone === 'warning' ? TriangleAlert
    : tone === 'success' ? Check : tone === 'muted' ? CircleSlash : LoaderCircle
  const singleItem = result?.items.length === 1 ? result.items[0] : undefined
  const failureMessage = task.error_message?.trim() || singleItem?.message?.trim()
  const showTable = Boolean(result?.items.length && (!rename || result.items.length > 1))
  return (
    <Modal open centered width={rename && !showTable ? 580 : 820} title={t(rename ? 'files.move.renameTitle' : 'files.move.title')} closable={canClose} mask={{ closable: canClose }} keyboard={canClose} onCancel={onClose}
      className={`termous-modal ${styles.modal}`} rootClassName={`${confirmDialogStyles['modal-root']} termous-modal-root`}
      footer={[
        running ? <Button key="cancel" loading={cancelling} disabled={!task.cancellable || cancelling} onClick={() => void cancel()}>{t(cancelling ? 'files.move.cancelling' : 'app.cancel')}</Button> : null,
        <Button key="close" type="primary" disabled={!canClose} onClick={onClose}>{t('files.move.close')}</Button>,
      ]}>
      <div className={styles.content}>
        <section className={styles.summary} role="status" aria-live="polite">
          <span className={styles.icon} data-tone={tone}><Icon size={21} aria-hidden="true" className={tone === 'accent' ? styles.spinning : undefined} /></span>
          <div className={styles.copy}>
            <h3>{t(`files.move.feedback.${feedback}`, { action })}</h3>
            {observationError ? <p>{t('files.move.observationFailed')}</p> : null}
            {observationError?.message.trim() ? <p>{observationError.message}</p> : null}
            {failureMessage ? <p>{failureMessage}</p> : null}
            {!showTable && singleItem?.message?.trim() && singleItem.message.trim() !== failureMessage ? <p>{singleItem.message}</p> : null}
            {!failureMessage && feedback === 'failed' ? <p>{t('files.operationFailed')}</p> : null}
            {uncertain ? <p>{t('files.move.uncertainHint')}</p> : partial ? <p>{t('files.move.partialHint')}</p> : feedback === 'cancelled' ? <p>{t('files.move.cancelledHint')}</p> : null}
            {running && !rename && !observationError && task.phase_label ? <p>{task.phase_label}</p> : null}
          </div>
        </section>
        {running && !observationError ? <Progress percent={Math.round(task.progress_percent)} size="small" /> : null}
        {rename ? <dl className={styles.paths}>
          <div><dt>{t('files.move.originalName')}</dt><dd title={rename.sourcePath}>{pathBase(rename.sourcePath)}</dd></div>
          <div><dt>{t('files.move.newName')}</dt><dd title={rename.targetPath}>{pathBase(rename.targetPath)}</dd></div>
          {parentPath(rename.sourcePath) === parentPath(rename.targetPath)
            ? <div className={styles.directory}><dt>{t('files.move.location')}</dt><dd>{parentPath(rename.sourcePath)}</dd></div>
            : <><div className={styles.directory}><dt>{t('files.move.source')}</dt><dd>{rename.sourcePath}</dd></div><div className={styles.directory}><dt>{t('files.move.target')}</dt><dd>{rename.targetPath}</dd></div></>}
        </dl> : null}
        {error || resultFailed ? <Alert className={styles.notice} type="warning" showIcon title={resultFailed ? t('files.move.resultFailed') : error} description={resultFailed && error.trim() ? error : undefined} /> : null}
        {showTable && result ? <Table className={styles.table} size="small" rowKey={(row) => row.source_path} dataSource={result.items} pagination={{ pageSize: 20, showSizeChanger: false, hideOnSinglePage: true }} scroll={{ x: 620 }}
          columns={[
            { title: t('files.move.source'), dataIndex: 'source_path', ellipsis: true, render: (value: string) => <Tooltip title={value}><span>{value}</span></Tooltip> },
            { title: t('files.move.target'), dataIndex: 'target_path', ellipsis: true, render: (value: string) => <Tooltip title={value}><span>{value}</span></Tooltip> },
            { title: t('files.move.status'), dataIndex: 'status', width: 210, render: (status: string, item) => <div className={styles.outcome}><span data-status={status}>{t(`files.move.statuses.${status}`)}</span>{item.message?.trim() && item.message.trim() !== failureMessage ? <small>{item.message}</small> : null}</div> },
          ]} /> : null}
      </div>
    </Modal>
  )
}
