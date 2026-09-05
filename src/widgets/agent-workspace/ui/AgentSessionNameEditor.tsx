import { Button, Input, type InputRef } from 'antd'
import { Check, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { sessionSidebarNameValid } from '../model/sessionSidebar.ts'
import styles from './AgentSessionSidebar.module.scss'

export function AgentSessionNameEditor({ value, label, busy, maxBytes = 200, maxCharacters, onSave, onCancel }: {
  value: string
  label: string
  busy: boolean
  maxBytes?: number
  maxCharacters?: number
  onSave: (value: string) => Promise<boolean>
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(value)
  const [attempted, setAttempted] = useState(false)
  const inputRef = useRef<InputRef>(null)
  const composing = useRef(false)
  const saving = useRef(false)
  const valid = sessionSidebarNameValid(draft, maxBytes, maxCharacters)
  useEffect(() => { inputRef.current?.focus({ cursor: 'all' }) }, [])
  const save = async () => {
    if (busy || saving.current || composing.current) return
    setAttempted(true)
    if (!valid) return
    saving.current = true
    try { await onSave(draft.trim()) } finally { saving.current = false }
  }
  return (
    <div className={styles['name-editor']} onClick={(event) => event.stopPropagation()} onContextMenu={(event) => event.stopPropagation()}>
      <div>
        <Input
          ref={inputRef}
          size="small"
          value={draft}
          aria-label={label}
          aria-invalid={attempted && !valid}
          status={attempted && !valid ? 'error' : undefined}
          disabled={busy}
          onChange={(event) => setDraft(event.target.value)}
          onCompositionStart={() => { composing.current = true }}
          onCompositionEnd={() => { composing.current = false }}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return
            if (event.key === 'Enter') { event.preventDefault(); void save() }
            if (event.key === 'Escape' && !busy && !saving.current) { event.preventDefault(); onCancel() }
          }}
        />
        <Button type="text" size="small" aria-label={t('app.save')} icon={<Check size={14} />} disabled={busy} loading={busy} onClick={() => void save()} />
        <Button type="text" size="small" aria-label={t('app.cancel')} icon={<X size={14} />} disabled={busy} onClick={onCancel} />
      </div>
      {attempted && !valid ? <span role="alert">{t(maxCharacters ? 'agent.sessions.invalidGroupName' : 'agent.sessions.invalidName', { count: maxCharacters ?? maxBytes })}</span> : null}
    </div>
  )
}
