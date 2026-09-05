import { Button, Input, Modal, type InputRef } from 'antd'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { sessionSidebarNameValid } from '../model/sessionSidebar.ts'
import styles from './AgentSessionCreateGroupDialog.module.scss'

export function AgentSessionCreateGroupDialog({ open, disabled, onCreate, onClose }: {
  open: boolean
  disabled: boolean
  onCreate: (name: string) => Promise<boolean>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const inputId = useId()
  const inputRef = useRef<InputRef>(null)
  const composing = useRef(false)
  const saving = useRef(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [failed, setFailed] = useState(false)
  const valid = sessionSidebarNameValid(name, 200, 64)
  useEffect(() => {
    if (open) return
    setName('')
    setAttempted(false)
    setFailed(false)
    composing.current = false
  }, [open])
  const create = async () => {
    if (disabled || saving.current || composing.current) return
    setAttempted(true)
    if (!valid) { inputRef.current?.focus(); return }
    saving.current = true
    setBusy(true)
    setFailed(false)
    try {
      if (await onCreate(name.trim())) onClose()
      else setFailed(true)
    } catch { setFailed(true) } finally {
      saving.current = false
      setBusy(false)
    }
  }
  return (
    <Modal
      open={open} centered width={400} title={t('agent.sessions.createGroup')}
      className={`termous-modal ${styles.dialog}`} destroyOnHidden
      mask={{ closable: !busy }} keyboard={!busy} closable={!busy}
      onCancel={() => { if (!busy) onClose() }}
      afterOpenChange={(visible) => { if (visible) inputRef.current?.focus() }}
      footer={[
        <Button key="cancel" disabled={busy} onClick={onClose}>{t('app.cancel')}</Button>,
        <Button key="create" type="primary" loading={busy} disabled={disabled} onClick={() => void create()}>{t('agent.sessions.createGroupSubmit')}</Button>,
      ]}
    >
      <div className={styles.content}>
        <label htmlFor={inputId}>{t('agent.sessions.groupName')}</label>
        <Input
          id={inputId} ref={inputRef} value={name} disabled={disabled || busy}
          placeholder={t('agent.sessions.groupNamePlaceholder')}
          aria-invalid={attempted && !valid}
          aria-describedby={attempted && !valid || failed ? `${inputId}-error` : undefined}
          status={attempted && !valid ? 'error' : undefined}
          suffix={<span className={styles.count}>{Array.from(name).length}/64</span>}
          onChange={(event) => { setName(event.target.value); setFailed(false) }}
          onCompositionStart={() => { composing.current = true }}
          onCompositionEnd={() => { composing.current = false }}
          onKeyDown={(event) => {
            if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return
            if (event.key === 'Enter') { event.preventDefault(); void create() }
          }}
        />
        {attempted && !valid || failed ? <p id={`${inputId}-error`} className={styles.error} role="alert">{t(!valid ? 'agent.sessions.invalidGroupName' : 'agent.sessions.createGroupFailed', { count: 64 })}</p> : null}
      </div>
    </Modal>
  )
}
