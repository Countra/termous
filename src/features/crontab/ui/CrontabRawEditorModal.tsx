import { Alert, App, Button, Modal } from 'antd'
import { indentWithTab } from '@codemirror/commands'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { vscodeDarkInit, vscodeLightInit } from '@uiw/codemirror-theme-vscode'
import { FileCode2, RefreshCw, Save } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CrontabSnapshot } from '#entities/crontab'
import { TermousApiError } from '#shared/api'
import {
  confirmDialogStyles,
  termousNotificationClassName,
} from '#shared/ui'
import type { ThemeMode } from '#shared/theme'
import { isCrontabWriteUncertainError } from '../model/mutationErrors'
import styles from './CrontabRawEditor.module.scss'

interface CrontabRawEditorModalProps {
  open: boolean
  snapshot: CrontabSnapshot
  theme: ThemeMode
  writable: boolean
  saving: boolean
  onClose: () => void
  onSave: (content: string, expectedRevision: string) => Promise<CrontabSnapshot>
  onReload: () => Promise<CrontabSnapshot | null>
}

const editorTheme = new Compartment()
const editorEditable = new Compartment()
const editorAccessibility = new Compartment()

export function CrontabRawEditorModal({
  open,
  snapshot,
  theme,
  writable,
  saving,
  onClose,
  onSave,
  onReload,
}: CrontabRawEditorModalProps) {
  const { t } = useTranslation()
  const { modal, notification } = App.useApp()
  const [editorHost, setEditorHost] = useState<HTMLDivElement | null>(null)
  const editorViewRef = useRef<EditorView | null>(null)
  const initialContentRef = useRef(snapshot.content ?? '')
  const initialThemeRef = useRef(theme)
  const initialWritableRef = useRef(writable)
  const mountedRef = useRef(false)
  const contentRef = useRef(snapshot.content ?? '')
  const editorLabelRef = useRef(t('workbench.crontab.raw.editorLabel'))
  editorLabelRef.current = t('workbench.crontab.raw.editorLabel')
  const saveRef = useRef<() => boolean>(() => false)
  const suppressChangesRef = useRef(false)
  const confirmationOpenRef = useRef(false)
  const confirmDestroyRef = useRef<(() => void) | null>(null)
  const [dirty, setDirty] = useState(false)
  const [conflicted, setConflicted] = useState(false)
  const [error, setError] = useState('')
  const [reloading, setReloading] = useState(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      confirmDestroyRef.current?.()
      confirmDestroyRef.current = null
      confirmationOpenRef.current = false
    }
  }, [])

  const replaceEditorContent = useCallback((content: string) => {
    contentRef.current = content
    const view = editorViewRef.current
    if (!view) {
      return
    }
    suppressChangesRef.current = true
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
    })
    suppressChangesRef.current = false
  }, [])

  useEffect(() => {
    if (!open || !editorHost) {
      return undefined
    }
    const initialContent = initialContentRef.current
    contentRef.current = initialContent
    setDirty(false)
    setConflicted(false)
    setError('')
    const view = new EditorView({
      parent: editorHost,
      state: EditorState.create({
        doc: initialContent,
        extensions: [
          basicSetup,
          keymap.of([
            indentWithTab,
            {
              key: 'Mod-s',
              preventDefault: true,
              run: () => saveRef.current(),
            },
          ]),
          EditorView.lineWrapping,
          editorTheme.of(codeMirrorTheme(initialThemeRef.current)),
          editorEditable.of(EditorView.editable.of(initialWritableRef.current)),
          editorAccessibility.of(EditorView.contentAttributes.of({
            'aria-label': editorLabelRef.current,
          })),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || suppressChangesRef.current) {
              return
            }
            contentRef.current = update.state.sliceDoc()
            setDirty(true)
            setError('')
          }),
        ],
      }),
    })
    editorViewRef.current = view
    view.focus()
    return () => {
      view.destroy()
      if (editorViewRef.current === view) {
        editorViewRef.current = null
      }
    }
  }, [editorHost, open])

  useEffect(() => {
    editorViewRef.current?.dispatch({
      effects: editorTheme.reconfigure(codeMirrorTheme(theme)),
    })
  }, [theme])

  useEffect(() => {
    editorViewRef.current?.dispatch({
      effects: editorEditable.reconfigure(EditorView.editable.of(
        writable && !saving && !reloading && !conflicted,
      )),
    })
  }, [conflicted, reloading, saving, writable])

  useEffect(() => {
    if (writable) {
      return
    }
    confirmDestroyRef.current?.()
    confirmDestroyRef.current = null
    confirmationOpenRef.current = false
  }, [writable])

  useEffect(() => {
    editorViewRef.current?.dispatch({
      effects: editorAccessibility.reconfigure(EditorView.contentAttributes.of({
        'aria-label': t('workbench.crontab.raw.editorLabel'),
      })),
    })
  }, [t])

  const saveContent = useCallback(async () => {
    if (!writable || !dirty || saving || reloading || conflicted) {
      return
    }
    setError('')
    try {
      await onSave(contentRef.current, snapshot.revision)
      if (!mountedRef.current) {
        return
      }
      setDirty(false)
      notification.success({
        title: t('workbench.crontab.raw.saved'),
        duration: 2.5,
        role: 'status',
        className: termousNotificationClassName,
      })
      onClose()
    } catch (saveError) {
      if (!mountedRef.current) {
        return
      }
      if (saveError instanceof TermousApiError && saveError.code === 'CRONTAB_CONFLICT') {
        setConflicted(true)
        setError(t('workbench.crontab.raw.conflict'))
        return
      }
      if (isCrontabWriteUncertainError(saveError)) {
        setConflicted(true)
        setError(t('workbench.crontab.raw.uncertain'))
        return
      }
      setError(saveError instanceof Error ? saveError.message : t('workbench.crontab.raw.saveFailed'))
    }
  }, [conflicted, dirty, notification, onClose, onSave, reloading, saving, snapshot.revision, t, writable])

  const requestSave = useCallback(() => {
    if (!writable || !dirty || saving || reloading || conflicted || confirmationOpenRef.current) {
      return false
    }
    confirmationOpenRef.current = true
    const confirmation = modal.confirm({
      centered: true,
      className: confirmDialogStyles.modal,
      rootClassName: confirmDialogStyles['modal-wrap'],
      title: t('workbench.crontab.raw.confirmTitle'),
      content: t('workbench.crontab.raw.confirmContent', { username: snapshot.username }),
      okText: t('workbench.crontab.raw.confirmAction'),
      cancelText: t('app.cancel'),
      onOk: saveContent,
      afterClose: () => {
        confirmDestroyRef.current = null
        confirmationOpenRef.current = false
      },
    })
    confirmDestroyRef.current = confirmation.destroy
    return true
  }, [conflicted, dirty, modal, reloading, saveContent, saving, snapshot.username, t, writable])

  useEffect(() => {
    saveRef.current = requestSave
  }, [requestSave])

  const reload = useCallback(async () => {
    if (saving || reloading) {
      return
    }
    setReloading(true)
    setError('')
    try {
      const nextSnapshot = await onReload()
      if (!mountedRef.current || !nextSnapshot) {
        return
      }
      replaceEditorContent(nextSnapshot.content ?? '')
      setDirty(false)
      setConflicted(false)
    } catch (reloadError) {
      if (mountedRef.current) {
        setError(reloadError instanceof Error ? reloadError.message : t('workbench.crontab.raw.reloadFailed'))
      }
    } finally {
      if (mountedRef.current) {
        setReloading(false)
      }
    }
  }, [onReload, reloading, replaceEditorContent, saving, t])

  const requestReload = useCallback(() => {
    if (reloading || confirmationOpenRef.current) {
      return
    }
    if (!dirty) {
      void reload()
      return
    }
    confirmationOpenRef.current = true
    const confirmation = modal.confirm({
      centered: true,
      className: confirmDialogStyles.modal,
      rootClassName: confirmDialogStyles['modal-wrap'],
      title: t('workbench.crontab.raw.reloadConfirmTitle'),
      content: t('workbench.crontab.raw.reloadConfirmContent'),
      okText: t('workbench.crontab.raw.reload'),
      cancelText: t('app.cancel'),
      onOk: reload,
      afterClose: () => {
        confirmDestroyRef.current = null
        confirmationOpenRef.current = false
      },
    })
    confirmDestroyRef.current = confirmation.destroy
  }, [dirty, modal, reload, reloading, t])

  const requestClose = useCallback(() => {
    if (saving || reloading) {
      return
    }
    if (!dirty) {
      onClose()
      return
    }
    if (confirmationOpenRef.current) {
      return
    }
    confirmationOpenRef.current = true
    const confirmation = modal.confirm({
      centered: true,
      className: confirmDialogStyles.modal,
      rootClassName: confirmDialogStyles['modal-wrap'],
      title: t('workbench.crontab.raw.discardTitle'),
      content: t('workbench.crontab.raw.discardContent'),
      okText: t('workbench.crontab.raw.discard'),
      cancelText: t('app.cancel'),
      onOk: onClose,
      afterClose: () => {
        confirmDestroyRef.current = null
        confirmationOpenRef.current = false
      },
    })
    confirmDestroyRef.current = confirmation.destroy
  }, [dirty, modal, onClose, reloading, saving, t])

  return (
    <Modal
      open={open}
      centered
      destroyOnHidden
      width={780}
      className={`termous-modal ${styles.modal}`}
      rootClassName={styles.root}
      title={(
        <span className={styles.title}>
          <FileCode2 size={17} aria-hidden="true" />
          <span>{t('workbench.crontab.raw.title')}</span>
          <small>{snapshot.username}</small>
        </span>
      )}
      footer={(
        <div className={styles.footer}>
          <Button
            icon={<RefreshCw size={14} />}
            loading={reloading}
            disabled={saving}
            onClick={requestReload}
          >
            {t('workbench.crontab.raw.reload')}
          </Button>
          <span className={styles['footer-spacer']} />
          <Button disabled={saving || reloading} onClick={requestClose}>{t('app.cancel')}</Button>
          <Button
            type="primary"
            icon={<Save size={14} />}
            loading={saving}
            disabled={!writable || !dirty || reloading || conflicted}
            onClick={requestSave}
          >
            {t('workbench.crontab.raw.save')}
          </Button>
        </div>
      )}
      mask={{ closable: false }}
      closable={!saving && !reloading}
      keyboard={!saving && !reloading}
      onCancel={requestClose}
    >
      <div className={styles.body}>
        <Alert
          type="warning"
          showIcon
          title={t('workbench.crontab.raw.warningTitle')}
          description={t('workbench.crontab.raw.warningContent')}
        />
        {!writable ? (
          <Alert
            type="warning"
            showIcon
            title={t('workbench.crontab.readOnly')}
            description={t('workbench.crontab.readOnlyHint')}
          />
        ) : null}
        {error ? <Alert type={conflicted ? 'warning' : 'error'} showIcon title={error} /> : null}
        {snapshot.unmanaged_line_count > 0 ? (
          <div className={styles.warnings}>
            <span>{t('workbench.crontab.unmanagedLines', {
              count: snapshot.unmanaged_line_count,
            })}</span>
          </div>
        ) : null}
        <div className={styles.frame}>
          <div className={styles.framebar}>
            <span>{t('workbench.crontab.raw.source')}</span>
            <code>{snapshot.revision.slice(0, 12)}</code>
          </div>
          <div
            ref={setEditorHost}
            className={styles.editor}
            aria-label={t('workbench.crontab.raw.editorLabel')}
          />
        </div>
      </div>
    </Modal>
  )
}

function codeMirrorTheme(theme: ThemeMode) {
  return theme === 'light'
    ? vscodeLightInit({ settings: { fontFamily: 'var(--font-mono, Consolas, monospace)' } })
    : vscodeDarkInit({ settings: { fontFamily: 'var(--font-mono, Consolas, monospace)' } })
}
