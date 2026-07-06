import { App as AntdApp, Button, Modal, Spin, Tag } from 'antd'
import { basicSetup } from 'codemirror'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { languages } from '@codemirror/language-data'
import { AlertTriangle, Code2, FileText, RefreshCw, Save } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TermousApiError, type TermousApi } from '../../api/client'
import type { RemoteFileEntry, RemoteTextFile, RemoteTextLineEnding } from '../../types/domain'
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
  const [file, setFile] = useState<RemoteTextFile | null>(null)
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const title = useMemo(() => {
    if (!file) {
      return t('files.textEditorTitle')
    }
    return file.name || path
  }, [file, path, t])

  const currentContent = useCallback(() => editorViewRef.current?.state.doc.toString() ?? content, [content])

  const loadFile = useCallback(async () => {
    if (!open || !fileSessionId || !path) {
      return
    }
    const requestSeq = loadSeqRef.current + 1
    loadSeqRef.current = requestSeq
    setLoading(true)
    setError(null)
    try {
      const loaded = await api.openFileSessionTextFile(fileSessionId, path)
      if (loadSeqRef.current !== requestSeq) {
        return
      }
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
    } finally {
      if (loadSeqRef.current === requestSeq) {
        setLoading(false)
      }
    }
  }, [api, fileSessionId, open, path, t])

  const saveFile = useCallback(async (force = false) => {
    if (!file || !fileSessionId || savingRef.current) {
      return
    }
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      const result = await api.saveFileSessionTextFile(fileSessionId, {
        path: file.path,
        content: currentContent(),
        base_sha256: file.sha256,
        base_size: file.size,
        base_modified_at: file.modified_at,
        line_ending: file.line_ending,
        has_bom: file.has_bom,
        force,
      })
      setFile(result.file)
      setContent(result.file.content)
      setDirty(false)
      onSaved(result.entry, result.file)
      message.success(t('files.textEditorSaved'))
    } catch (saveError) {
      if (saveError instanceof TermousApiError && saveError.code === 'SFTP_TEXT_CONFLICT' && !force) {
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
        setError(remoteTextErrorMessage(saveError, t))
      }
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [api, currentContent, file, fileSessionId, message, modal, onSaved, t])

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

  useEffect(
    () => () => {
      loadSeqRef.current++
    },
    [],
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
          {loading ? (
            <div className="remote-text-editor-state">
              <Spin />
              <strong>{t('files.textEditorLoading')}</strong>
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
