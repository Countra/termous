import { App as AntdApp, Button, Modal, Tag } from 'antd'
import { basicSetup } from 'codemirror'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { languages } from '@codemirror/language-data'
import { AlertTriangle, Code2, FileText, RefreshCw, Save } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TermousApiError, type TermousApi } from '../../api/client'
import type { FileOperationTask, RemoteFileEntry, RemoteTextFile, RemoteTextLineEnding, RemoteTextSaveResult } from '../../types/domain'
import { FileOperationProgress, type FileOperationProgressState } from './FileOperationProgress'
import { formatBytes } from './fileUtils'

interface RemoteTextEditorModalProps {
  api: TermousApi
  open: boolean
  fileSessionId: string
  path: string
  onClose: () => void
  onSaved: (entry: RemoteFileEntry, file: RemoteTextFile) => void
}

const editorLanguage = new Compartment()

export function RemoteTextEditorModal({ api, open, fileSessionId, path, onClose, onSaved }: RemoteTextEditorModalProps) {
  const { t } = useTranslation()
  const { message, modal } = AntdApp.useApp()
  const editorHostRef = useRef<HTMLDivElement>(null)
  const editorViewRef = useRef<EditorView | null>(null)
  const loadSeqRef = useRef(0)
  const saveFileRef = useRef<(force?: boolean) => void>(() => undefined)
  const savingRef = useRef(false)
  const operationTimersRef = useRef<number[]>([])
  const operationCleanupRef = useRef<(() => void) | null>(null)
  const activeOperationIdRef = useRef<string | null>(null)
  const activeOperationDoneRef = useRef(false)
  const [file, setFile] = useState<RemoteTextFile | null>(null)
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [operationProgress, setOperationProgress] = useState<FileOperationProgressState | null>(null)

  const title = useMemo(() => {
    if (!file) {
      return t('files.textEditorTitle')
    }
    return file.name || path
  }, [file, path, t])

  const currentContent = useCallback(() => editorViewRef.current?.state.doc.toString() ?? content, [content])

  const clearOperationTimers = useCallback(() => {
    operationTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    operationTimersRef.current = []
  }, [])

  const finishOperationProgress = useCallback((progress: FileOperationProgressState, clearDelay = 900) => {
    clearOperationTimers()
    setOperationProgress(progress)
    const timer = window.setTimeout(() => setOperationProgress(null), clearDelay)
    operationTimersRef.current.push(timer)
  }, [clearOperationTimers])

  const cancelActiveOperation = useCallback(() => {
    operationCleanupRef.current?.()
    operationCleanupRef.current = null
    const operationId = activeOperationIdRef.current
    const done = activeOperationDoneRef.current
    activeOperationIdRef.current = null
    activeOperationDoneRef.current = false
    if (operationId && !done) {
      void api.cancelFileOperation(operationId).catch(() => undefined)
    }
  }, [api])

  const progressFromTask = useCallback((task: FileOperationTask, title: string, successText: string, failedText: string): FileOperationProgressState => {
    const failed = task.status === 'failed' || task.status === 'cancelled'
    const completed = task.status === 'completed'
    const phaseTotal = task.phase_total_bytes || task.total_bytes || 0
    const phaseTransferred = task.phase_total_bytes > 0 ? task.phase_transferred_bytes : task.transferred_bytes
    const detail = phaseTotal > 0 && task.status === 'running'
      ? `${task.phase_label || title} · ${formatBytes(phaseTransferred)} / ${formatBytes(phaseTotal)}`
      : task.phase_label || (completed ? successText : failed ? task.error_message || failedText : title)
    return {
      title,
      description: detail,
      progress: completed ? 100 : Math.max(0, Math.min(100, task.progress_percent || 0)),
      status: completed ? 'success' : failed ? 'error' : 'running',
      indeterminate: task.status === 'running' && phaseTotal <= 0 && (task.progress_percent || 0) <= 0,
    }
  }, [])

  const watchFileOperation = useCallback((
    initialTask: FileOperationTask,
    title: string,
    successText: string,
    failedText: string,
  ) => new Promise<FileOperationTask>((resolve, reject) => {
    let settled = false
    let disposed = false
    let socket: WebSocket | null = null
    let pollTimer = 0
    let lastRevision = 0
    let lastProgress = 0

    const cleanup = () => {
      disposed = true
      clearPollTimer()
      if (socket && socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) {
        socket.close()
      }
      if (operationCleanupRef.current === cleanup) {
        operationCleanupRef.current = null
      }
    }

    const settle = (callback: () => void) => {
      if (settled) {
        return
      }
      settled = true
      activeOperationDoneRef.current = true
      activeOperationIdRef.current = null
      cleanup()
      callback()
    }

    function clearPollTimer() {
      if (pollTimer) {
        window.clearTimeout(pollTimer)
        pollTimer = 0
      }
    }

    function schedulePoll(delay: number) {
      if (disposed || settled) {
        return
      }
      clearPollTimer()
      pollTimer = window.setTimeout(poll, delay)
    }

    function poll() {
      if (disposed || settled) {
        return
      }
      pollTimer = 0
      void api.fileOperation(initialTask.id)
        .then(handleTask)
        .catch(() => undefined)
        .finally(() => {
          if (!disposed && !settled) {
            schedulePoll(1000)
          }
        })
    }

    const handleTask = (task: FileOperationTask) => {
      if (disposed || task.id !== initialTask.id) {
        return
      }
      const terminal = task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled'
      const revision = task.revision || 0
      if (revision > 0) {
        if (revision < lastRevision || (revision === lastRevision && !terminal)) {
          return
        }
        lastRevision = revision
      } else if (!terminal && (task.progress_percent || 0) < lastProgress) {
        return
      }
      const nextProgress = task.status === 'completed'
        ? 100
        : Math.max(lastProgress, Math.max(0, Math.min(100, task.progress_percent || 0)))
      lastProgress = nextProgress
      const displayTask = { ...task, progress_percent: nextProgress }
      setOperationProgress(progressFromTask(displayTask, title, successText, failedText))
      if (!terminal) {
        schedulePoll(2000)
      }
      if (displayTask.status === 'completed') {
        settle(() => resolve(task))
      } else if (displayTask.status === 'failed' || displayTask.status === 'cancelled') {
        const code = displayTask.error_code || (displayTask.status === 'cancelled' ? 'FILE_OPERATION_CANCELLED' : 'FILE_OPERATION_FAILED')
        settle(() => reject(new TermousApiError(displayTask.error_message || failedText, code, 0)))
      }
    }

    operationCleanupRef.current = cleanup
    activeOperationIdRef.current = initialTask.id
    activeOperationDoneRef.current = false
    handleTask(initialTask)
    try {
      socket = new WebSocket(api.fileOperationEventsUrl(initialTask.file_session_id))
      socket.addEventListener('message', (event: MessageEvent<string>) => {
        try {
          const payload = JSON.parse(String(event.data)) as { type?: string; task?: FileOperationTask }
          if (payload.type === 'file_operation_update' && payload.task) {
            handleTask(payload.task)
          }
        } catch {
          // 忽略单条异常事件，轮询会继续兜底同步状态。
        }
      })
      socket.addEventListener('close', () => {
        if (!disposed && !settled) {
          schedulePoll(250)
        }
      })
      socket.addEventListener('error', () => {
        if (!disposed && !settled) {
          schedulePoll(250)
        }
      })
    } catch {
      schedulePoll(250)
    }
    if (!pollTimer) {
      schedulePoll(1000)
    }
  }), [api, progressFromTask])

  const loadFile = useCallback(async () => {
    if (!open || !fileSessionId || !path) {
      return
    }
    const requestSeq = loadSeqRef.current + 1
    loadSeqRef.current = requestSeq
    cancelActiveOperation()
    setLoading(true)
    setError(null)
    clearOperationTimers()
    setOperationProgress({
      title: t('files.fileOperationReadTitle'),
      description: t('files.fileOperationReadPrepare'),
      progress: 0,
      status: 'running',
      indeterminate: true,
    })
    try {
      const operation = await api.createFileSessionTextReadOperation(fileSessionId, path)
      await watchFileOperation(
        operation,
        t('files.fileOperationReadTitle'),
        t('files.fileOperationReadReady'),
        t('files.fileOperationReadFailed'),
      )
      const loaded = await api.fileOperationResult<RemoteTextFile>(operation.id)
      if (loadSeqRef.current !== requestSeq) {
        return
      }
      clearOperationTimers()
      setOperationProgress(null)
      setFile(loaded)
      setContent(loaded.content)
      setDirty(false)
    } catch (loadError) {
      if (loadSeqRef.current !== requestSeq) {
        return
      }
      setFile(null)
      setContent('')
      setDirty(false)
      setError(remoteTextErrorMessage(loadError, t))
      finishOperationProgress({
        title: t('files.fileOperationReadTitle'),
        description: t('files.fileOperationReadFailed'),
        progress: 100,
        status: 'error',
      })
    } finally {
      if (loadSeqRef.current === requestSeq) {
        setLoading(false)
      }
    }
  }, [api, cancelActiveOperation, clearOperationTimers, fileSessionId, finishOperationProgress, open, path, t, watchFileOperation])

  const saveFile = useCallback(async (force = false) => {
    if (!file || !fileSessionId || savingRef.current) {
      return
    }
    cancelActiveOperation()
    savingRef.current = true
    setSaving(true)
    setError(null)
    clearOperationTimers()
    setOperationProgress({
      title: t('files.fileOperationSaveTitle'),
      description: t('files.fileOperationSaveCheck'),
      progress: 0,
      status: 'running',
      indeterminate: true,
    })
    try {
      const operation = await api.createFileSessionTextSaveOperation(fileSessionId, {
        path: file.path,
        content: currentContent(),
        base_sha256: file.sha256,
        base_size: file.size,
        base_modified_at: file.modified_at,
        line_ending: file.line_ending,
        has_bom: file.has_bom,
        force,
      })
      await watchFileOperation(
        operation,
        t('files.fileOperationSaveTitle'),
        t('files.fileOperationSaveReady'),
        t('files.fileOperationSaveFailed'),
      )
      const result = await api.fileOperationResult<RemoteTextSaveResult>(operation.id)
      setFile(result.file)
      setContent(result.file.content)
      setDirty(false)
      onSaved(result.entry, result.file)
      message.success(t('files.textEditorSaved'))
      clearOperationTimers()
      setOperationProgress(null)
    } catch (saveError) {
      if (saveError instanceof TermousApiError && saveError.code === 'SFTP_TEXT_CONFLICT' && !force) {
        clearOperationTimers()
        setOperationProgress(null)
        modal.confirm({
          title: t('files.textEditorConflictTitle'),
          content: t('files.textEditorConflictContent'),
          okText: t('files.textEditorForceSave'),
          cancelText: t('app.cancel'),
          className: 'confirm-modal remote-text-confirm-modal',
          rootClassName: 'confirm-modal-wrap',
          onOk: () => saveFileRef.current(true),
        })
      } else {
        const errorMessage = remoteTextErrorMessage(saveError, t)
        message.error(errorMessage)
        finishOperationProgress({
          title: t('files.fileOperationSaveTitle'),
          description: errorMessage || t('files.fileOperationSaveFailed'),
          progress: 100,
          status: 'error',
        }, 2600)
      }
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [api, cancelActiveOperation, clearOperationTimers, currentContent, file, fileSessionId, finishOperationProgress, message, modal, onSaved, t, watchFileOperation])

  useEffect(() => {
    saveFileRef.current = (force = false) => {
      void saveFile(force)
    }
  }, [saveFile])

  const requestClose = useCallback(() => {
    if (!dirty) {
      onClose()
      return
    }
    modal.confirm({
      title: t('files.textEditorUnsavedTitle'),
      content: t('files.textEditorUnsavedContent'),
      okText: t('files.textEditorDiscard'),
      cancelText: t('app.cancel'),
      className: 'confirm-modal remote-text-confirm-modal',
      rootClassName: 'confirm-modal-wrap',
      onOk: onClose,
    })
  }, [dirty, modal, onClose, t])

  useEffect(() => {
    if (open) {
      void loadFile()
    }
  }, [loadFile, open])

  useEffect(() => {
    if (open) {
      return
    }
    loadSeqRef.current++
    cancelActiveOperation()
    clearOperationTimers()
    setOperationProgress(null)
  }, [cancelActiveOperation, clearOperationTimers, open])

  useEffect(
    () => () => {
      loadSeqRef.current++
      cancelActiveOperation()
      clearOperationTimers()
    },
    [cancelActiveOperation, clearOperationTimers],
  )

  useEffect(() => {
    if (!open || !file || !editorHostRef.current) {
      return
    }

    editorViewRef.current?.destroy()
    const view = new EditorView({
      parent: editorHostRef.current,
      state: EditorState.create({
        doc: file.content,
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          EditorView.lineWrapping,
          editorLanguage.of([]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) {
              return
            }
            const nextContent = update.state.doc.toString()
            setContent(nextContent)
            setDirty(nextContent !== file.content)
          }),
        ],
      }),
    })
    editorViewRef.current = view
    setTimeout(() => view.focus(), 0)

    return () => {
      view.destroy()
      if (editorViewRef.current === view) {
        editorViewRef.current = null
      }
    }
  }, [file, open])

  useEffect(() => {
    let disposed = false
    if (!open || !file || !editorViewRef.current) {
      return () => {
        disposed = true
      }
    }
    const description = languageDescription(file)
    if (!description) {
      editorViewRef.current.dispatch({ effects: editorLanguage.reconfigure([]) })
      return () => {
        disposed = true
      }
    }
    void description.load().then((support) => {
      if (!disposed && editorViewRef.current) {
        editorViewRef.current.dispatch({ effects: editorLanguage.reconfigure(support) })
      }
    })
    return () => {
      disposed = true
    }
  }, [file, open])

  useEffect(() => {
    if (!open) {
      return
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveFile(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, saveFile])

  return (
    <Modal
      open={open}
      width="min(1120px, calc(100vw - 64px))"
      title={null}
      footer={null}
      centered
      destroyOnHidden
      className="termous-modal remote-text-editor-modal"
      rootClassName="termous-modal-root remote-text-editor-root"
      onCancel={requestClose}
    >
      <section className="remote-text-editor">
        <header className="remote-text-editor-header">
          <div className="remote-text-editor-title">
            <span className="remote-text-editor-icon">
              <Code2 size={18} aria-hidden="true" />
            </span>
            <div>
              <strong>{title}</strong>
              <span>{file?.path ?? path}</span>
            </div>
          </div>
          <div className="remote-text-editor-meta">
            {file ? (
              <>
                <Tag>{file.language || t('files.textEditorPlainText')}</Tag>
                <Tag>{lineEndingLabel(file.line_ending, t)}</Tag>
                <Tag>{formatBytes(file.size)}</Tag>
                {dirty ? <Tag className="is-dirty">{t('files.textEditorDirty')}</Tag> : null}
              </>
            ) : null}
          </div>
        </header>

        <div className="remote-text-editor-body">
          {operationProgress && !error ? (
            <div className="remote-text-editor-operation-toast">
              <FileOperationProgress
                title={operationProgress.title}
                description={operationProgress.description}
                progress={operationProgress.progress}
                status={operationProgress.status}
                indeterminate={operationProgress.indeterminate}
                compact
              />
            </div>
          ) : null}
          {loading ? (
            <div className="remote-text-editor-frame is-placeholder" aria-hidden="true">
              <div className="remote-text-editor-framebar">
                <span>{t('files.textEditorPlainText')}</span>
                <span />
              </div>
              <div className="remote-text-editor-loading-canvas" />
            </div>
          ) : error ? (
            <div className="remote-text-editor-state is-error">
              <AlertTriangle size={24} aria-hidden="true" />
              <strong>{error}</strong>
              <Button className="secondary-button" icon={<RefreshCw size={14} />} onClick={() => void loadFile()}>
                {t('files.textEditorReload')}
              </Button>
            </div>
          ) : (
            <div className="remote-text-editor-frame">
              <div className="remote-text-editor-framebar">
                <span>{file?.language || t('files.textEditorPlainText')}</span>
                <span>{file ? `${lineEndingLabel(file.line_ending, t)} · ${formatBytes(file.size)}` : ''}</span>
              </div>
              <div ref={editorHostRef} className="remote-text-editor-codemirror" />
            </div>
          )}
        </div>

        <footer className="remote-text-editor-footer">
          <div className="remote-text-editor-hint">
            <FileText size={14} aria-hidden="true" />
            <span>{t('files.textEditorHint')}</span>
          </div>
          <div className="remote-text-editor-actions">
            <Button className="secondary-button" disabled={loading || saving} onClick={() => void loadFile()}>
              {t('files.textEditorReload')}
            </Button>
            <Button className="secondary-button" disabled={saving} onClick={requestClose}>
              {t('app.close')}
            </Button>
            <Button
              type="primary"
              className="primary-button"
              disabled={!file || loading || !dirty}
              loading={saving}
              icon={<Save size={14} />}
              onClick={() => void saveFile(false)}
            >
              {t('files.textEditorSave')}
            </Button>
          </div>
        </footer>
      </section>
    </Modal>
  )
}

function languageDescription(file: RemoteTextFile) {
  const ext = extensionOf(file.name || file.path)
  const language = file.language?.toLowerCase()
  return languages.find((item) => {
    const aliases = (item.alias ?? []).map((alias) => alias.toLowerCase())
    const extensions = (item.extensions ?? []).map((value) => value.toLowerCase())
    return (language ? item.name.toLowerCase() === language || aliases.includes(language) : false) || (ext ? extensions.includes(ext) : false)
  })
}

function extensionOf(name: string) {
  const dot = name.lastIndexOf('.')
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : ''
}

function lineEndingLabel(value: RemoteTextLineEnding, t: (key: string) => string) {
  return t(`files.textEditorLineEnding.${value}`)
}

function remoteTextErrorMessage(error: unknown, t: (key: string) => string) {
  if (error instanceof TermousApiError) {
    if (error.code === 'SFTP_TEXT_TOO_LARGE') {
      return t('files.textEditorTooLarge')
    }
    if (error.code === 'SFTP_TEXT_NOT_EDITABLE') {
      return t('files.textEditorNotEditable')
    }
    if (error.code === 'SFTP_TEXT_UNSUPPORTED_ENCODING') {
      return t('files.textEditorUnsupported')
    }
    return error.message
  }
  return error instanceof Error ? error.message : t('app.error')
}
