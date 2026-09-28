import { Form, Input, Modal } from 'antd'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { normalizeRemotePosixPath } from '#shared/path'
import { confirmDialogStyles } from '#shared/ui'

interface RemoteRenameModalProps {
  initialName: string
  confirmLabel?: string
  onSubmit: (name: string) => Promise<void>
  onClose: () => void
}

export function RemoteRenameModal({ initialName, confirmLabel, onSubmit, onClose }: RemoteRenameModalProps) {
  const { t } = useTranslation()
  const [name, setName] = useState(initialName)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const pending = useRef(false)
  const errorId = useId()

  const submit = async () => {
    if (pending.current) return
    const cleanName = name.trim()
    if (!cleanName || cleanName === initialName) {
      setError(t(cleanName ? 'files.nameUnchanged' : 'files.nameRequired'))
      return
    }
    if (cleanName.includes('/') || cleanName === '.' || cleanName === '..' || normalizeRemotePosixPath(`/${cleanName}`) === null) {
      setError(t('files.renameNameInvalid'))
      return
    }
    pending.current = true
    setSaving(true)
    setError('')
    try {
      await onSubmit(cleanName)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error && cause.message.trim() ? cause.message : t('files.operationFailed'))
    } finally {
      pending.current = false
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      centered
      width={420}
      zIndex={3600}
      title={t('files.rename')}
      okText={confirmLabel ?? t('app.update')}
      cancelText={t('app.cancel')}
      confirmLoading={saving}
      cancelButtonProps={{ disabled: saving }}
      closable={!saving}
      keyboard={!saving}
      mask={{ closable: !saving }}
      className="termous-modal"
      rootClassName={`${confirmDialogStyles['modal-root']} termous-modal-root`}
      onCancel={() => { if (!pending.current) onClose() }}
      onOk={() => void submit()}
    >
      <Form.Item validateStatus={error ? 'error' : undefined} help={error ? <span id={errorId} role="alert">{error}</span> : null}>
        <Input
          autoFocus
          aria-label={t('files.rename')}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          value={name}
          disabled={saving}
          onChange={(event) => { setName(event.target.value); setError('') }}
          onPressEnter={() => void submit()}
        />
      </Form.Item>
    </Modal>
  )
}
