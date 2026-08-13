import { Alert, App as AntdApp, Button, Modal, Tag } from 'antd'
import { basicSetup } from 'codemirror'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { languages } from '@codemirror/language-data'
import { vscodeDarkInit, vscodeLightInit } from '@uiw/codemirror-theme-vscode'
import { AlertTriangle, Code2, FileText, RefreshCw, Save } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { TerminalSettings } from '#common/contracts'
import { TermousApiError } from '#shared/api'
import { confirmDialogStyles, uiStyles } from '#shared/ui'
import type {
  RemoteFileEntry,
  RemoteTextFile,
  RemoteTextLineEnding,
  RemoteTextSaveResult,
} from '#entities/file'
import type { ThemeMode } from '#shared/theme'
import { useShortcutRuntime } from '#entities/shortcuts'
import { FileOperationProgress, type FileOperationProgressState } from './FileOperationProgress'
import styles from './RemoteTextEditorModal.module.scss'
import sharedStyles from './RemoteFileModalShared.module.scss'
import type { FileOperationGateway } from '../model/fileOperationGateway'
import { formatBytes } from '#shared/format'
import { useFileOperationWatcher } from '../model/useFileOperationWatcher'

interface RemoteTextEditorModalProps {
  api: FileOperationGateway
  open: boolean
  disabled?: boolean
  closing?: boolean
  fileSessionId: string
  connectionGeneration: number
  path: string
  theme: ThemeMode
  terminalSettings: TerminalSettings
  onClose: () => void
  onSaved: (entry: RemoteFileEntry, file: RemoteTextFile) => void
}

const editorLanguage = new Compartment()
const editorTheme = new Compartment()
const editorEditable = new Compartment()

export function RemoteTextEditorModal({ api, open, disabled = false, closing = false, fileSessionId, connectionGeneration, path, theme, terminalSettings, onClose, onSaved }: RemoteTextEditorModalProps) {
  const { t } = useTranslation()
  const { runtime: shortcutRuntime } = useShortcutRuntime()
  const shortcutInstanceId = useId()
  const shortcutContextId = `files.editor:${shortcutInstanceId}`
  const { message, modal } = AntdApp.useApp()
  const editorShellRef = useRef<HTMLElement>(null)
  const editorHostRef = useRef<HTMLDivElement>(null)
  const editorViewRef = useRef<EditorView | null>(null)
  const editorThemeMode = terminalSettings.theme_mode === 'follow_app' ? theme : terminalSettings.theme_mode
  const editorThemeModeRef = useRef<ThemeMode>(editorThemeMode)
  const openRef = useRef(open)
  openRef.current = open
  const disabledRef = useRef(disabled)
  disabledRef.current = disabled
  const connectionGenerationRef = useRef(connectionGeneration)
  const previousConnectionGenerationRef = useRef(connectionGeneration)
  connectionGenerationRef.current = connectionGeneration
  const fileRef = useRef<RemoteTextFile | null>(null)
  const baseContentRef = useRef('')
  const loadSeqRef = useRef(0)
  const saveSeqRef = useRef(0)
  const loadControllerRef = useRef<AbortController | null>(null)
  const saveControllerRef = useRef<AbortController | null>(null)
  const loadingRef = useRef(false)
  const dirtyRef = useRef(false)
  const generationStaleRef = useRef(false)
  const reloadConfirmationOpenRef = useRef(false)
  const reloadConfirmationDestroyRef = useRef<(() => void) | null>(null)
  const saveFileRef = useRef<(force?: boolean) => void>(() => undefined)
  const savingRef = useRef(false)
  const [file, setFile] = useState<RemoteTextFile | null>(null)
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [generationStale, setGenerationStale] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [operationProgress, setOperationProgress] = useState<FileOperationProgressState | null>(null)
  const {
    cancelActiveOperation,
    clearOperationTimers,
    finishOperationProgress,
    watchFileOperation,
  } = useFileOperationWatcher({ api, setOperationProgress })
  dirtyRef.current = dirty

  const title = useMemo(() => {
    if (!file) {
      return t('files.textEditorTitle')
    }
    return file.name || path
  }, [file, path, t])

  const currentContent = useCallback(() => editorViewRef.current?.state.doc.toString() ?? content, [content])

  useEffect(() => {
    fileRef.current = file
    baseContentRef.current = file?.content ?? ''
  }, [file])

  const loadFile = useCallback(async (allowStaleGeneration = false) => {
    if (
      !open
      || !openRef.current
      || disabledRef.current
      || !fileSessionId
      || !path
      || (generationStaleRef.current && !allowStaleGeneration)
    ) {
      return
    }
    const requestSeq = loadSeqRef.current + 1
    const requestGeneration = connectionGenerationRef.current
    const controller = new AbortController()
    loadSeqRef.current = requestSeq
    loadControllerRef.current?.abort()
    loadControllerRef.current = controller
    const existingFile = fileRef.current
    cancelActiveOperation()
    loadingRef.current = true
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
      const operation = await api.createFileSessionTextReadOperation(
        fileSessionId,
        path,
        controller.signal,
      )
      if (
        loadSeqRef.current !== requestSeq
        || connectionGenerationRef.current !== requestGeneration
        || controller.signal.aborted
      ) {
        void api.cancelFileOperation(operation.id).catch(() => undefined)
        return
      }
      await watchFileOperation(
        operation,
        t('files.fileOperationReadTitle'),
        t('files.fileOperationReadReady'),
        t('files.fileOperationReadFailed'),
      )
      const loaded = await api.fileOperationResult<RemoteTextFile>(operation.id)
      if (
        loadSeqRef.current !== requestSeq
        || connectionGenerationRef.current !== requestGeneration
      ) {
        return
      }
      clearOperationTimers()
      setOperationProgress(null)
      setFile(loaded)
      setContent(loaded.content)
      setDirty(false)
      generationStaleRef.current = false
      setGenerationStale(false)
    } catch (loadError) {
      if (
        loadSeqRef.current !== requestSeq
        || connectionGenerationRef.current !== requestGeneration
      ) {
        return
      }
      if (!existingFile) {
        setFile(null)
        setContent('')
        setDirty(false)
      }
      setError(remoteTextErrorMessage(loadError, t))
      finishOperationProgress({
        title: t('files.fileOperationReadTitle'),
        description: t('files.fileOperationReadFailed'),
        progress: 100,
        status: 'error',
      })
    } finally {
      if (
        loadSeqRef.current === requestSeq
        && connectionGenerationRef.current === requestGeneration
      ) {
        loadingRef.current = false
        setLoading(false)
      }
      if (loadControllerRef.current === controller) {
        loadControllerRef.current = null
      }
    }
  }, [api, cancelActiveOperation, clearOperationTimers, fileSessionId, finishOperationProgress, open, path, t, watchFileOperation])

  const saveFile = useCallback(async (force = false) => {
    if (
      disabledRef.current
      || generationStaleRef.current
      || loadingRef.current
      || reloadConfirmationOpenRef.current
      || !file
      || !fileSessionId
      || savingRef.current
    ) {
      return
    }
    const saveSequence = saveSeqRef.current + 1
    const requestGeneration = connectionGenerationRef.current
    const controller = new AbortController()
    saveSeqRef.current = saveSequence
    saveControllerRef.current?.abort()
    saveControllerRef.current = controller
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
      const operation = await api.createFileSessionTextSaveOperation(
        fileSessionId,
        {
          path: file.path,
          content: currentContent(),
          base_sha256: file.sha256,
          base_size: file.size,
          base_modified_at: file.modified_at,
          line_ending: file.line_ending,
          has_bom: file.has_bom,
          force,
        },
        controller.signal,
      )
      if (
        saveSeqRef.current !== saveSequence
        || connectionGenerationRef.current !== requestGeneration
        || generationStaleRef.current
        || controller.signal.aborted
      ) {
        void api.cancelFileOperation(operation.id).catch(() => undefined)
        return
      }
      await watchFileOperation(
        operation,
        t('files.fileOperationSaveTitle'),
        t('files.fileOperationSaveReady'),
        t('files.fileOperationSaveFailed'),
      )
      const result = await api.fileOperationResult<RemoteTextSaveResult>(operation.id)
      if (
        saveSeqRef.current !== saveSequence
        || connectionGenerationRef.current !== requestGeneration
        || generationStaleRef.current
      ) {
        return
      }
      setFile(result.file)
      setContent(result.file.content)
      setDirty(false)
      onSaved(result.entry, result.file)
      message.success(t('files.textEditorSaved'))
      clearOperationTimers()
      setOperationProgress(null)
    } catch (saveError) {
      if (
        saveSeqRef.current !== saveSequence
        || connectionGenerationRef.current !== requestGeneration
        || generationStaleRef.current
      ) {
        return
      }
      if (saveError instanceof TermousApiError && saveError.code === 'SFTP_TEXT_CONFLICT' && !force) {
        clearOperationTimers()
        setOperationProgress(null)
        modal.confirm({
          title: t('files.textEditorConflictTitle'),
          content: t('files.textEditorConflictContent'),
          okText: t('files.textEditorForceSave'),
          cancelText: t('app.cancel'),
          className: `${confirmDialogStyles.modal} confirm-modal remote-text-confirm-modal`,
          rootClassName: `${confirmDialogStyles['modal-wrap']} confirm-modal-wrap`,
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
      if (saveSeqRef.current === saveSequence) {
        savingRef.current = false
        setSaving(false)
      }
      if (saveControllerRef.current === controller) {
        saveControllerRef.current = null
      }
    }
  }, [api, cancelActiveOperation, clearOperationTimers, currentContent, file, fileSessionId, finishOperationProgress, message, modal, onSaved, t, watchFileOperation])

  useEffect(() => {
    saveFileRef.current = (force = false) => {
      void saveFile(force)
    }
  }, [saveFile])

  useEffect(() => {
    const disposeContext = shortcutRuntime.pushContext({
      id: shortcutContextId,
      layer: 'focus',
      priority: 20,
      scopes: ['files.editor'],
      isActive: () => {
        const shell = editorShellRef.current
        const activeElement = document.activeElement
        return Boolean(openRef.current && shell && activeElement && shell.contains(activeElement))
      },
    })
    const disposeHandler = shortcutRuntime.registerHandler(
      shortcutContextId,
      'files.editor.save',
      () => {
        if (
          !openRef.current
          || disabledRef.current
          || generationStaleRef.current
          || loadingRef.current
          || reloadConfirmationOpenRef.current
          || !fileRef.current
          || savingRef.current
        ) {
          return 'blocked'
        }
        saveFileRef.current(false)
        return 'handled'
      },
    )
    return () => {
      disposeHandler()
      disposeContext()
    }
  }, [shortcutContextId, shortcutRuntime])

  useEffect(() => {
    editorThemeModeRef.current = editorThemeMode
    if (!editorViewRef.current) {
      return
    }
    editorViewRef.current.dispatch({ effects: editorTheme.reconfigure(codeMirrorTheme(editorThemeMode)) })
  }, [editorThemeMode])

  useEffect(() => {
    editorViewRef.current?.dispatch({ effects: editorEditable.reconfigure(EditorView.editable.of(!disabled)) })
  }, [disabled])

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
      className: `${confirmDialogStyles.modal} confirm-modal remote-text-confirm-modal`,
      rootClassName: `${confirmDialogStyles['modal-wrap']} confirm-modal-wrap`,
      onOk: onClose,
    })
  }, [dirty, modal, onClose, t])

  const requestReload = useCallback(() => {
    if (reloadConfirmationOpenRef.current) {
      return
    }
    const reload = () => {
      void loadFile(true)
    }
    if (!dirty) {
      reload()
      return
    }
    reloadConfirmationOpenRef.current = true
    const confirmation = modal.confirm({
      title: t('files.textEditorReloadConfirmTitle'),
      content: t('files.textEditorReloadConfirmContent'),
      okText: t('files.textEditorReload'),
      cancelText: t('app.cancel'),
      className: `${confirmDialogStyles.modal} confirm-modal remote-text-confirm-modal`,
      rootClassName: `${confirmDialogStyles['modal-wrap']} confirm-modal-wrap`,
      onOk: reload,
      afterClose: () => {
        reloadConfirmationOpenRef.current = false
        reloadConfirmationDestroyRef.current = null
      },
    })
    reloadConfirmationDestroyRef.current = confirmation.destroy
  }, [dirty, loadFile, modal, t])

  useEffect(() => {
    if (previousConnectionGenerationRef.current === connectionGeneration) {
      return
    }
    previousConnectionGenerationRef.current = connectionGeneration
    loadSeqRef.current += 1
    saveSeqRef.current += 1
    loadControllerRef.current?.abort()
    loadControllerRef.current = null
    saveControllerRef.current?.abort()
    saveControllerRef.current = null
    cancelActiveOperation()
    clearOperationTimers()
    savingRef.current = false
    loadingRef.current = false
    setLoading(false)
    setSaving(false)
    setOperationProgress(null)
    setError(null)
    generationStaleRef.current = true
    setGenerationStale(true)
  }, [
    cancelActiveOperation,
    clearOperationTimers,
    connectionGeneration,
  ])

  useEffect(() => {
    if (
      open
      && !disabled
      && !(generationStaleRef.current && dirtyRef.current)
    ) {
      void loadFile(generationStaleRef.current)
    }
  }, [connectionGeneration, disabled, loadFile, open])

  useEffect(() => {
    if (open) {
      return
    }
    editorViewRef.current?.destroy()
    editorViewRef.current = null
    loadSeqRef.current++
    saveSeqRef.current++
    loadControllerRef.current?.abort()
    loadControllerRef.current = null
    saveControllerRef.current?.abort()
    saveControllerRef.current = null
    savingRef.current = false
    loadingRef.current = false
    reloadConfirmationOpenRef.current = false
    const destroyReloadConfirmation = reloadConfirmationDestroyRef.current
    reloadConfirmationDestroyRef.current = null
    destroyReloadConfirmation?.()
    setLoading(false)
    setSaving(false)
    cancelActiveOperation()
    clearOperationTimers()
    setOperationProgress(null)
  }, [cancelActiveOperation, clearOperationTimers, open])

  useEffect(
    () => () => {
      loadSeqRef.current++
      saveSeqRef.current++
      loadControllerRef.current?.abort()
      loadControllerRef.current = null
      saveControllerRef.current?.abort()
      saveControllerRef.current = null
      savingRef.current = false
      loadingRef.current = false
      reloadConfirmationOpenRef.current = false
      const destroyReloadConfirmation = reloadConfirmationDestroyRef.current
      reloadConfirmationDestroyRef.current = null
      destroyReloadConfirmation?.()
      editorViewRef.current?.destroy()
      editorViewRef.current = null
      cancelActiveOperation()
      clearOperationTimers()
    },
    [cancelActiveOperation, clearOperationTimers],
  )

  useEffect(() => {
    if (!open || !file || !editorHostRef.current) {
      return
    }

    baseContentRef.current = file.content
    const existingView = editorViewRef.current
    if (existingView) {
      const currentDoc = existingView.state.doc.toString()
      if (currentDoc !== file.content) {
        existingView.dispatch({
          changes: {
            from: 0,
            to: existingView.state.doc.length,
            insert: file.content,
          },
        })
      }
      setContent(file.content)
      setDirty(false)
      return
    }

    const view = new EditorView({
      parent: editorHostRef.current,
      state: EditorState.create({
        doc: file.content,
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          EditorView.lineWrapping,
          editorLanguage.of([]),
          editorTheme.of(codeMirrorTheme(editorThemeModeRef.current)),
          editorEditable.of(EditorView.editable.of(!disabledRef.current)),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) {
              return
            }
            const nextContent = update.state.doc.toString()
            setContent(nextContent)
            setDirty(nextContent !== baseContentRef.current)
          }),
        ],
      }),
    })
    editorViewRef.current = view
    setTimeout(() => view.focus(), 0)

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

  const handleShortcutKeyDownCapture = useCallback((event: KeyboardEvent<HTMLElement>) => {
    const result = shortcutRuntime.dispatch(event.nativeEvent, {
      adapterId: `files-editor:${shortcutInstanceId}`,
      contextIds: [shortcutContextId],
      editable: true,
    })
    if (result.result === 'handled' || result.result === 'blocked') {
      event.preventDefault()
      event.stopPropagation()
    }
  }, [shortcutContextId, shortcutInstanceId, shortcutRuntime])

  return (
    <Modal
      open={open}
      width="min(1120px, calc(100vw - 64px))"
      title={null}
      footer={null}
      centered
      destroyOnHidden
      className="termous-modal remote-text-editor-modal"
      rootClassName={`${confirmDialogStyles['modal-root']} termous-modal-root remote-text-editor-root ${styles.root} ${theme === 'light' ? styles.light : ''} ${sharedStyles.root}`}
      onCancel={requestClose}
    >
      <section
        ref={editorShellRef}
        className={`remote-text-editor is-editor-${editorThemeMode}`}
        data-shortcut-adapter="files-editor"
        aria-busy={loading || saving || undefined}
        onKeyDownCapture={handleShortcutKeyDownCapture}
      >
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
            {closing ? (
              <Tag color="processing">{t('files.sessionStatus.closing')}</Tag>
            ) : disabled ? (
              <Tag color="warning">{t('files.sessionStatus.disconnected')}</Tag>
            ) : null}
            {generationStale ? <Tag color="warning">{t('files.textEditorConnectionChangedShort')}</Tag> : null}
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

        <div className={`remote-text-editor-body ${generationStale ? 'has-connection-alert' : ''}`}>
          {generationStale ? (
            <Alert
              type="warning"
              showIcon
              className="remote-text-editor-connection-alert"
              title={t('files.textEditorConnectionChanged')}
              description={error || t('files.textEditorConnectionChangedHint')}
              action={(
                <Button
                  type="text"
                  size="small"
                  disabled={disabled || loading || saving}
                  onClick={requestReload}
                >
                  {t('files.textEditorReload')}
                </Button>
              )}
            />
          ) : null}
          {operationProgress ? (
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
          {loading && !file ? (
            <div className="remote-text-editor-frame is-placeholder" aria-hidden="true">
              <div className="remote-text-editor-framebar">
                <span>{t('files.textEditorPlainText')}</span>
                <span />
              </div>
              <div className="remote-text-editor-loading-canvas" />
            </div>
          ) : error && !file ? (
            <div className="remote-text-editor-state is-error">
              <AlertTriangle size={24} aria-hidden="true" />
              <strong>{error}</strong>
              <Button className={`${uiStyles['secondary-button']} secondary-button`} disabled={disabled} icon={<RefreshCw size={14} />} onClick={requestReload}>
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
            <Button className={`${uiStyles['secondary-button']} secondary-button`} disabled={disabled || loading || saving} onClick={requestReload}>
              {t('files.textEditorReload')}
            </Button>
            <Button className={`${uiStyles['secondary-button']} secondary-button`} disabled={saving} onClick={requestClose}>
              {t('app.close')}
            </Button>
            <Button
              type="primary"
              className={`${uiStyles['primary-button']} primary-button`}
              disabled={disabled || generationStale || !file || loading || !dirty}
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

function codeMirrorTheme(theme: ThemeMode) {
  const settings = {
    caret: 'var(--remote-editor-cursor, #5da8ff)',
    fontFamily: 'var(--terminal-font-family, "JetBrains Mono", Consolas, monospace)',
    fontSize: 'var(--terminal-font-size, 13px)',
  }
  return theme === 'light' ? vscodeLightInit({ settings }) : vscodeDarkInit({ settings })
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
